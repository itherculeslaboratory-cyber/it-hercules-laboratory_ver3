// E1 横断検索 第1段(design R0801-c618a6-REPORT-2026-08-01-g78-b3think.md §1-3・§2 案1・
// §2-1)。putEvent が毎回書く受領索引 index/receipt/<date>/ の IndexEntry(store.ts の
// writeIndexEntry / index-entry.ts)を日付プレフィックス単位で走査するフリーテキスト横断
// 検索。新規ストレージ0(既存の書込経路に相乗り)。UI配線(obs-search 導線)は次ラウンド
// (束E1のスコープ外)。
import { Hono } from "hono";
import { TruthStore } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { captureVisibleTo, CAPTURE_TYPE } from "./observation-routes";

export const crossSearchRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// R2BucketLite.list has no cursor / truncated field (store.ts R2ListResult = { objects:
// { key: string }[] } only) — real Cloudflare R2 silently caps a single prefix listing at
// 1000 keys (b3think §1-2 実測). Detected per date-prefix below, not assumed globally.
const LIST_TRUNCATION_CAP = 1000;

// 期間指定が無い場合の既定(b3think §2-1「期間指定を必須にするか、既定=直近N日にする」)。
const DEFAULT_WINDOW_DAYS = 7;

// 「全期間から探す」を素直に書くと運用日数ぶんの list が1クエリで走る(b3think §2-1)。
// 日付プレフィックス1本 = list 呼び出し1回なので、上限を超える範囲は拒否する。
const MAX_WINDOW_DAYS = 90;

// g80-vis1(design R0801-7b17da §2-3 案C'補強2「初期設定は拒否」): 可視性の判定規則が
// 確立している型だけを出す許可リスト。visibility列を持たない型(pt_event/photo/measurement等)
// は規則が無いため既定で出さない。captureのみ captureVisibleTo で行除外して通す。
const VISIBILITY_RULED_TYPES = new Set<string>([CAPTURE_TYPE]);

interface RawIndexEntry {
  event_id: string;
  type: string;
  subject: string | null;
  actor_id: string | null;
  payload_key: string;
  received_at: string;
  text_repr: string | null;
  visibility: string | null;
}

interface CrossSearchResultRow {
  event_id: string;
  type: string;
  subject: string | null;
  actor_id: string | null;
  received_at: string;
  payload_key: string;
  text_repr: string | null;
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function enumerateDates(from: string, to: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cur.getTime() <= end.getTime()) {
    out.push(toDateOnly(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

// GET /api/v1/search — index/receipt/ 再利用の全エンティティ横断検索(第1段・APIのみ)。
// Protected by the default session gate (not registered in PUBLIC_ROUTES) — V3-AUT-16
// の「ログイン済ユーザーは全観測カタログを横断検索・閲覧できる」と同じスコープ(owner_user_id
// による絞り込みは行わない)。
crossSearchRoutes.get("/search", async (c) => {
  const q = c.req.query("q");
  const typeFilter = c.req.query("type");
  const subjectFilter = c.req.query("subject");
  const actorIdFilter = c.req.query("actor_id");
  const fromParam = c.req.query("from");
  const toParam = c.req.query("to");

  if ((fromParam && !DATE_RE.test(fromParam)) || (toParam && !DATE_RE.test(toParam))) {
    return c.json({ error: "INVALID_QUERY", details: ["from/to must be YYYY-MM-DD"] }, 400);
  }

  const to = toParam ?? toDateOnly(new Date());
  const from =
    fromParam ??
    toDateOnly(new Date(new Date(`${to}T00:00:00.000Z`).getTime() - (DEFAULT_WINDOW_DAYS - 1) * 86_400_000));

  if (from > to) {
    return c.json({ error: "INVALID_QUERY", details: ["from must be <= to"] }, 400);
  }

  const dates = enumerateDates(from, to);
  if (dates.length > MAX_WINDOW_DAYS) {
    return c.json(
      {
        error: "INVALID_QUERY",
        details: [`range too wide: ${dates.length} days requested > ${MAX_WINDOW_DAYS} day cap`],
      },
      400,
    );
  }

  const s = store(c);
  const viewerActorId = c.get("actorId");
  const results: CrossSearchResultRow[] = [];
  const truncatedDates: string[] = [];
  const qLower = q?.toLowerCase();

  for (const date of dates) {
    const prefix = `index/receipt/${date}/`;
    // listEvents = bucket.list(prefix) + get-each (store.ts 既存メソッドの再利用。
    // IndexEntry は素の JSON なので Record<string, unknown>[] のまま型を絞るだけで足りる)。
    const entries = (await s.listEvents(prefix)) as unknown as RawIndexEntry[];
    if (entries.length >= LIST_TRUNCATION_CAP) truncatedDates.push(date);

    for (const e of entries) {
      // g80-vis1 補強2(既定拒否): 許可リスト外の型は無条件で出さない。
      if (!VISIBILITY_RULED_TYPES.has(e.type)) continue;
      // g80-vis1(案C'): captureVisibleTo は既存の読み取り経路(observation-routes.ts)
      // と同じ純関数を再利用する — E1 専用の別ロジックを新設しない(reuse-first)。
      if (!captureVisibleTo({ visibility: e.visibility, actor_id: e.actor_id }, viewerActorId)) continue;
      if (typeFilter && e.type !== typeFilter) continue;
      if (subjectFilter && e.subject !== subjectFilter) continue;
      if (actorIdFilter && e.actor_id !== actorIdFilter) continue;
      if (qLower) {
        if (typeof e.text_repr !== "string" || !e.text_repr.toLowerCase().includes(qLower)) continue;
      }
      results.push({
        event_id: e.event_id,
        type: e.type,
        subject: e.subject,
        actor_id: e.actor_id,
        received_at: e.received_at,
        payload_key: e.payload_key,
        text_repr: e.text_repr,
      });
    }
  }

  results.sort((a, b) => a.received_at.localeCompare(b.received_at));

  return c.json({
    query: {
      q: q ?? null,
      type: typeFilter ?? null,
      subject: subjectFilter ?? null,
      actor_id: actorIdFilter ?? null,
      from,
      to,
    },
    count: results.length,
    results,
    // 誇張ゼロ(b3think §2-1・1000件天井の実測)。打ち切りが起きた日付を正直に列挙する。
    truncated: truncatedDates.length > 0,
    truncated_dates: truncatedDates,
    // 誇張ゼロ(b3think §1-3): text_repr は dataschema が既知スキーマの時だけ生成され、
    // 未知型は null(index-entry.ts buildTextRepr)。よってフリーテキスト q はこれらに
    // ヒットしない(type/subject/actor_id フィルタは既知/未知を問わず効く)。
    unknown_type_note:
      "text_repr is null for events whose dataschema is not a known frozen/event schema " +
      "(index-entry.ts buildTextRepr) — those events cannot match free-text `q`, though " +
      "type/subject/actor_id filters still apply to them.",
    // append-only(store.ts: TruthStore に update/delete が無い)。訂正後も旧イベントの
    // 索引は残るため、同一 subject の新旧が両方ヒットしうる。第1段では畳まない
    // (b3think §2-1) — received_at を見て呼び出し側が最新を判断すること。
    dedup_note:
      "append-only index: a corrected event's prior index entry is never removed, so old " +
      "and new revisions of the same subject may both appear in results — this endpoint does " +
      "not collapse them; use received_at to pick the latest.",
    // 誇張ゼロ(g80-vis1 design R0801-7b17da §2-3 補強2)。可視性の判定規則が確立している
    // 型(capture)だけを対象とし、規則の無い型は既定で拒否する。範囲を戻すには型ごとに
    // 規則を定義する別作業が要る(同報告書§5「決められなかったこと」1)。
    visibility_scope_note:
      "results are currently limited to capture events (ihl.obs.capture.v1) whose visibility " +
      "rule is established; other event types have no visibility rule yet and are excluded by " +
      "default (deny-by-default) until their rules are defined.",
  });
});
