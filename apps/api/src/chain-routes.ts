// S3(design R0801-f383db §2論点3/§5論点1/§6論点2/§7 S3行、HQ裁定R74-1/R74-2):
// 日次ルート R_D の導出 + 根に限り put-if-absent 保存(R74-1)+ GET /chain/root 読み出しAPI。
//
// r_D = worldHash(その日の index/receipt/<date>/ 配下の索引エントリの不変部のみ)。
// text_repr/text_repr_v(可変部・§6論点2)を混入させるとテンプレ改版のたびに過去の根が
// 変わり公開済みの根と食い違う(§6論点2の地雷)ので、ここで機械的に落とす。
// R_D = sha256(R_{D-1} ‖ r_D)。R_{D-1} は index/root/<D-1>.json から読み、無ければ genesis
// (GENESIS_HASH)扱い(§5論点1)。worldHash/sha256Hex は既存実装を再利用し、新規ハッシュ
// 実装はしない(§7 S3行の逐語)。
import { Hono } from "hono";
import { TruthStore, worldHash, sha256Hex, GENESIS_HASH } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import {
  CADENCE_TYPE,
  deriveCadenceGaps,
  receivedAtForSubject,
  type CadenceDeclaration,
  type CadenceGap,
} from "./cadence-routes";

export const chainRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function rootKeyFor(date: string): string {
  return `index/root/${date}.json`;
}

function prevDateOf(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function nextDateOf(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** 索引エントリの不変部のみ(§6論点2: text_repr/text_repr_v はルート計算対象外。
 *  g80-vis1(design R0801-7b17da §2-3 案C'補強1): visibility/consent_l3 も同じ理由で
 *  可変部 — 撤回されうるポリシー情報であり、元値は event_hash(不変部)でハッシュ済み
 *  なので根の計算から外しても完全性は担保される)。 */
function immutablePartOf(entry: Record<string, unknown>): Record<string, unknown> {
  const {
    text_repr: _textRepr,
    text_repr_v: _textReprV,
    visibility: _visibility,
    consent_l3: _consentL3,
    ...rest
  } = entry;
  return rest;
}

export interface DailyRoot {
  date: string;
  root: string;
  prev_root: string;
  event_count: number;
}

/**
 * その日の r_D と件数。空集合は worldHash 自体の既定挙動どおり EMPTY_WORLD_HASH になる
 * (design §7「空の日は EMPTY_WORLD_HASH」)。
 */
export async function computeDayRoot(
  s: TruthStore,
  date: string,
): Promise<{ r: string; count: number }> {
  const entries = await s.listEvents(`index/receipt/${date}/`);
  const nodes: Record<string, unknown> = {};
  entries.forEach((e, i) => {
    const id = typeof e.event_id === "string" ? e.event_id : `#${i}`;
    nodes[id] = immutablePartOf(e);
  });
  return { r: await worldHash(nodes), count: entries.length };
}

/** index/root/<D-1>.json から前日ルートを読む。無い日は genesis(§5論点1)。 */
async function readPrevRoot(env: Bindings, date: string): Promise<string> {
  const obj = await env.TRUTH.get(rootKeyFor(prevDateOf(date)));
  if (!obj) return GENESIS_HASH;
  const prev = JSON.parse(await obj.text()) as DailyRoot;
  return prev.root;
}

/** R_D = sha256(R_{D-1} ‖ r_D)(design §2論点3)。保存はしない(呼び出し側の責務)。 */
export async function deriveDailyRoot(env: Bindings, date: string): Promise<DailyRoot> {
  const { r, count } = await computeDayRoot(new TruthStore(env.TRUTH), date);
  const prevRoot = await readPrevRoot(env, date);
  const root = await sha256Hex(prevRoot + r);
  return { date, root, prev_root: prevRoot, event_count: count };
}

/**
 * R74-1: 根に限り put-if-absent で1日1件保存する(「ルートは保存しない」原則の例外)。
 * 既に保存済みならその値をそのまま返す — 2回導出しても1件・値が変わらない。put-if-absent
 * が競合を返した場合(同時実行)も、先着した側の値を読み直して返す(食い違いを出さない)。
 */
export async function ensureDailyRootStored(env: Bindings, date: string): Promise<DailyRoot> {
  const key = rootKeyFor(date);
  const existing = await env.TRUTH.get(key);
  if (existing) return JSON.parse(await existing.text()) as DailyRoot;

  const derived = await deriveDailyRoot(env, date);
  const putResult = await env.TRUTH.put(key, JSON.stringify(derived), {
    onlyIf: { etagDoesNotMatch: "*" },
  });
  if (putResult === null) {
    const winner = await env.TRUTH.get(key);
    if (winner) return JSON.parse(await winner.text()) as DailyRoot;
  }
  return derived;
}

// S5(design R0801-f383db §3論点2案C/§5論点1/§7 S5行、HQ申し送り=R0801-ac7fec 判断3):
// 日次ルートに欠測サマリ(streams_expected/gap_count/gaps[])を同梱する。
// 穴の導出そのものはS4の deriveCadenceGaps(純関数)・receivedAtForSubject を読み取りで
// 再利用するだけで、新規の穴導出ロジックはここに書かない。ここで書くのは「date D の枠に
// 絞り込む」ための集約(全subject横断のcadence宣言列挙 + groupごとの deriveCadenceGaps
// 呼び出し結果を date D の範囲でフィルタする)のみ。
// ★保存済みの根(index/root/<D>.json)の値・R_D のハッシュ計算には一切触れない
// (ensureDailyRootStored/deriveDailyRoot/computeDayRoot は無変更)。読み出し時に都度導出して
// 応答へ添えるだけ(S4の「穴は保存しない」原則の延長・§3論点2案Cのとおり)。
export interface DailyGapSummary {
  streams_expected: number;
  gap_count: number;
  gaps: Array<CadenceGap & { subject_id: string; stream_kind: string }>;
}

/**
 * date D の終端(排他的上限)より前に発効した cadence 宣言だけを対象にする
 * (D より後にしか効かない宣言は D の期待には含めない)。stream_kind 型フィルタは
 * S4の判断を継続して見送り(下記「判断が要った箇所」参照)= 受領側は subject 一致のみで判定。
 */
async function activeCadenceDeclarations(s: TruthStore, dateEndMs: number): Promise<CadenceDeclaration[]> {
  const rows = (await s.listEvents(`truth/${CADENCE_TYPE}/`)).map((e) => ({
    ...((e.data ?? {}) as Record<string, unknown>),
    received_at: e.received_at,
  }));
  return rows.filter((d): d is CadenceDeclaration => {
    if (
      typeof d.stream_kind !== "string" ||
      typeof d.subject_id !== "string" ||
      typeof d.expected_interval_s !== "number" ||
      typeof d.effective_from !== "string" ||
      typeof d.received_at !== "string"
    ) {
      return false;
    }
    const windowStartMs = Math.max(Date.parse(d.effective_from), Date.parse(d.received_at));
    return windowStartMs < dateEndMs;
  });
}

/** date D の欠測サマリを都度導出する(保存しない)。 */
export async function computeDailyGapSummary(env: Bindings, date: string): Promise<DailyGapSummary> {
  const s = new TruthStore(env.TRUTH);
  const dateStartMs = Date.parse(`${date}T00:00:00.000Z`);
  const dateEndMs = Date.parse(`${nextDateOf(date)}T00:00:00.000Z`);
  const declarations = await activeCadenceDeclarations(s, dateEndMs);

  const groups = new Map<string, CadenceDeclaration[]>();
  for (const d of declarations) {
    const key = `${d.subject_id}::${d.stream_kind}`;
    const arr = groups.get(key);
    if (arr) arr.push(d);
    else groups.set(key, [d]);
  }

  const gaps: Array<CadenceGap & { subject_id: string; stream_kind: string }> = [];
  for (const decls of groups.values()) {
    const subjectId = decls[0].subject_id;
    const streamKind = decls[0].stream_kind;
    const earliestMs = Math.min(
      ...decls.map((d) => Math.max(Date.parse(d.effective_from), Date.parse(d.received_at))),
    );
    const receivedAtList = await receivedAtForSubject(s, subjectId, earliestMs, dateEndMs);
    const result = deriveCadenceGaps(decls, receivedAtList, new Date(dateEndMs).toISOString());
    for (const g of result.gaps) {
      const slotMs = Date.parse(g.slot);
      if (slotMs >= dateStartMs && slotMs < dateEndMs) {
        gaps.push({ ...g, subject_id: subjectId, stream_kind: streamKind });
      }
    }
  }

  return { streams_expected: groups.size, gap_count: gaps.length, gaps };
}

// GET /chain/root?date=YYYY-MM-DD — 公開読み出し(R74-2で index.ts PUBLIC_ROUTES に登録)。
chainRoutes.get("/chain/root", async (c) => {
  const date = c.req.query("date") ?? "";
  if (!DATE_RE.test(date)) {
    return c.json({ error: "INVALID_DATE" }, 400);
  }
  const result = await ensureDailyRootStored(c.env, date);
  const summary = await computeDailyGapSummary(c.env, date);
  return c.json({ ...result, ...summary });
});
