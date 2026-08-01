// 背骨S4(設計R0801-f383db §3 D-2 / §7 S4行、HQ裁定R74-4は本Tの範囲外=payout未着手):
// ihl.obs.cadence.v1(提出ペース宣言) + 穴の導出(保存しない・§3論点2案C)。
//
// 穴は「宣言スロット − 受領索引」で読み出し時に導出する(TruthStoreへは何も書かない)。
// 受領索引はS2(packages/truth/src/index-entry.ts)が putEvent/putEventAt の入口で
// index/receipt/<date>/<received_at_ms>-<event_id>.json へ既に書いている(subject/type
// 付き)。ここは新しい索引を作らず、その既存索引を日付ごとに listEvents で読むだけ
// (chain-routes.ts computeDayRoot と同じ「index/receipt/<date>/」prefix読みの再利用)。
//
// ★遡及宣言は不採用(§3論点1): ある宣言が実際に効き始めるのは
// max(宣言の effective_from, 宣言イベント自身の received_at) から。
// 後から effective_from を過去に遡らせても、既に他の宣言(または未宣言)が支配していた
// 期間の穴の判定は変わらない — deriveCadenceGaps がタイムライン上で宣言ごとの
// 「支配区間」を received_at 昇順に切って計算するため。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";

export const cadenceRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

export const CADENCE_TYPE = "ihl.obs.cadence.v1";
const CADENCE_SCHEMA = "schemas/events/obs-cadence.schema.json";
const CADENCE_FIELDS = ["stream_kind", "subject_id", "expected_interval_s", "tolerance_s", "effective_from"] as const;

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}

function envelope(id: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: CADENCE_TYPE,
    time: new Date().toISOString(),
    dataschema: CADENCE_SCHEMA,
    subject: String(data.subject_id ?? ""),
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}

function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

// POST /observation/cadence — append a cadence declaration (202/400).
// actor_id is ALWAYS the session principal (V3-AUT-17) — client-supplied
// actor_id, if any, is ignored (CADENCE_FIELDS doesn't include it).
cadenceRoutes.post("/observation/cadence", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ error: "INVALID_BODY" }, 400);
  const actorId = c.get("actorId");
  const cadenceId = ulid();
  const data: Record<string, unknown> = { cadence_id: cadenceId, actor_id: actorId };
  for (const k of CADENCE_FIELDS) if (body[k] !== undefined) data[k] = body[k];

  const subjectId = typeof data.subject_id === "string" ? data.subject_id : "";
  if (!subjectId) return c.json({ error: "INVALID_BODY", details: ["subject_id required"] }, 400);

  const key = `truth/${CADENCE_TYPE}/${subjectId}-${cadenceId}.json`;
  const res = await store(c).putEventAt(key, envelope(cadenceId, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_CADENCE", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_CADENCE", key: res.key }, 409);
  return c.json({ cadence_id: cadenceId }, 202);
});

// GET /observation/cadence/:subject_id — list declarations for a subject
// (transparency/debug read; 論点3の「宣言密度を隠さず表示する」の最小形)。
cadenceRoutes.get("/observation/cadence/:subject_id", async (c) => {
  const subjectId = c.req.param("subject_id");
  const rows = (await store(c).listEvents(`truth/${CADENCE_TYPE}/${subjectId}-`)).map(dataOf);
  return c.json({ subject_id: subjectId, declarations: rows });
});

export interface CadenceDeclaration {
  stream_kind: string;
  subject_id: string;
  expected_interval_s: number;
  tolerance_s?: number;
  effective_from: string;
  received_at: string;
}

export interface CadenceGap {
  slot: string; // ISO の期待提出時刻
}

export interface CadenceGapResult {
  cadence_declared: boolean;
  gap_count: number;
  gaps: CadenceGap[];
}

/**
 * declarations を received_at 昇順に並べ、隣り合う宣言の間を「支配区間」として切る。
 * 各区間の開始 = max(その宣言の effective_from, その宣言自身の received_at)
 * (★遡及宣言不採用 — 宣言の received_at より前には決して遡らない)。
 * 区間の終了 = 次の宣言の received_at(無ければ asOf)。
 * 区間内で expected_interval_s 間隔のスロットを生成し、tolerance_s 以内に
 * receivedAtList のいずれかが無ければ穴とする。
 *
 * declarations が空 = cadence_declared:false(§3論点3「未宣言は継続性の主張なし」。
 * 穴ゼロとは別物として表示する)。
 */
export function deriveCadenceGaps(
  declarations: CadenceDeclaration[],
  receivedAtList: string[],
  asOf: string,
): CadenceGapResult {
  if (declarations.length === 0) {
    return { cadence_declared: false, gap_count: 0, gaps: [] };
  }
  const sorted = [...declarations].sort((a, b) => a.received_at.localeCompare(b.received_at));
  const receivedMs = receivedAtList.map((s) => Date.parse(s)).filter((ms) => Number.isFinite(ms));
  const asOfMs = Date.parse(asOf);

  const gaps: CadenceGap[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const decl = sorted[i];
    const declaredStartMs = Date.parse(decl.effective_from);
    const receivedAtMs = Date.parse(decl.received_at);
    // ★遡及宣言不採用: 支配区間の開始はこの宣言の received_at より前へは遡らない。
    const windowStartMs = Math.max(declaredStartMs, receivedAtMs);
    // 次の宣言の received_at で区間が切られる(排他)。次が無ければ asOf まで(包含 —
    // 「今この瞬間」もスロットたり得る)。windowEndMs===asOfMs のときだけ包含にする
    // — でないと隣接区間の境界スロットが両区間で二重に判定されてしまう。
    const nextRawMs = i + 1 < sorted.length ? Date.parse(sorted[i + 1].received_at) : Infinity;
    const windowEndMs = Math.min(nextRawMs, asOfMs);
    if (windowEndMs <= windowStartMs) continue;
    const includesEnd = windowEndMs === asOfMs;

    const intervalMs = decl.expected_interval_s * 1000;
    const toleranceMs = (decl.tolerance_s ?? 0) * 1000;
    if (!(intervalMs > 0)) continue;

    for (let slotMs = windowStartMs; slotMs < windowEndMs || (includesEnd && slotMs === windowEndMs); slotMs += intervalMs) {
      const satisfied = receivedMs.some((r) => Math.abs(r - slotMs) <= toleranceMs);
      if (!satisfied) gaps.push({ slot: new Date(slotMs).toISOString() });
    }
  }
  return { cadence_declared: true, gap_count: gaps.length, gaps };
}

// index/receipt/<date>/ prefix を asOf まで日付ごとに舐める(chain-routes.ts
// computeDayRoot と同じ prefix 読みの再利用。新しい索引は作らない)。
function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function nextDate(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** subjectId 宛ての受領索引エントリ(cadence宣言自身を除く)の received_at 一覧。 */
export async function receivedAtForSubject(
  s: TruthStore,
  subjectId: string,
  fromMs: number,
  toMs: number,
): Promise<string[]> {
  const out: string[] = [];
  if (!(fromMs <= toMs)) return out;
  let date = isoDate(fromMs);
  const endDate = isoDate(toMs);
  // 安全弁: 支配区間が異常に長い場合でも無限ループしない(1万日 ≒ 27年で打ち切り)。
  for (let guard = 0; guard < 10_000 && date <= endDate; guard++, date = nextDate(date)) {
    const entries = await s.listEvents(`index/receipt/${date}/`);
    for (const e of entries) {
      if (e.subject === subjectId && e.type !== CADENCE_TYPE && typeof e.received_at === "string") {
        out.push(e.received_at);
      }
    }
  }
  return out;
}

// GET /observation/cadence/:subject_id/gaps?stream_kind=...&as_of=... — 穴の導出
// (保存しない・毎回計算)。stream_kind 省略時はその subject の全宣言を対象にする。
cadenceRoutes.get("/observation/cadence/:subject_id/gaps", async (c) => {
  const subjectId = c.req.param("subject_id");
  const streamKind = c.req.query("stream_kind");
  const asOfRaw = c.req.query("as_of");
  const asOf = asOfRaw && !Number.isNaN(Date.parse(asOfRaw)) ? asOfRaw : new Date().toISOString();

  const declarations = (await store(c).listEvents(`truth/${CADENCE_TYPE}/${subjectId}-`))
    .map((e) => ({ ...dataOf(e), received_at: e.received_at }))
    .filter((d): d is CadenceDeclaration =>
      typeof d.stream_kind === "string" &&
      typeof d.subject_id === "string" &&
      typeof d.expected_interval_s === "number" &&
      typeof d.effective_from === "string" &&
      typeof d.received_at === "string" &&
      (streamKind === undefined || d.stream_kind === streamKind),
    );

  if (declarations.length === 0) {
    return c.json({ subject_id: subjectId, as_of: asOf, cadence_declared: false, gap_count: 0, gaps: [] });
  }

  const earliestMs = Math.min(
    ...declarations.map((d) => Math.max(Date.parse(d.effective_from), Date.parse(d.received_at))),
  );
  const asOfMs = Date.parse(asOf);
  const receivedAtList = await receivedAtForSubject(store(c), subjectId, earliestMs, asOfMs);

  const result = deriveCadenceGaps(declarations, receivedAtList, asOf);
  return c.json({ subject_id: subjectId, as_of: asOf, ...result });
});
