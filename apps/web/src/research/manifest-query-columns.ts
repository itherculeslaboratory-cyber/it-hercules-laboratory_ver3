// F2(design R0801-c618a6-REPORT-2026-08-01-g78-b3think.md §4-3): 研究者モードの
// JSON検索エディタが触ってよい列・演算子のホワイトリスト。新しい安全機構は作らない —
// 既存前例(apps/api/src/sandbox-routes.ts の SANDBOX_WHITELIST + WHITELIST_VIOLATION)
// と同じ流儀の定数集合を、ここ1箇所にだけ置く。
//
// ★列集合は libs/datalake/manifest.py の DEFAULT_MANIFEST_COLUMNS(F1実装, cea2bf3)と
// 意図的に同じ内容にしてある(IndexEntry 16列 − actor_id)。Python 側が唯一のソース
// ではない — F2 はブラウザ内 duckdb-wasm で SQL を組み立てるため、この TS 側の集合が
// 実際に効く制約になる。2言語間でズレたら意味が無いので、値を変えるときは両方に
// 手を入れること(コード生成での自動同期は今回のスコープ外 — §9 判断参照)。
export const RESEARCH_QUERY_COLUMNS: ReadonlySet<string> = new Set([
  "event_id",
  "type",
  "subject",
  // actor_id は既定除外(F1 §3 の判断を踏襲。投稿者を一意特定できる人物系フィールド。
  // カード B3-A(○85点)は「他ユーザーの観測データを含めるか」という行の線引きを
  // 承認したものであり、actor_id 列そのものを配るかという別軸の判断ではない。
  // F2 でもこの既定を変えていない — §9-2 参照)。
  "payload_key",
  "payload_bytes",
  "event_hash",
  "received_at",
  "claimed_at",
  "sig_alg",
  "key_id",
  "sig",
  "signed_bytes_sha256",
  "sig_verified",
  "text_repr",
  "text_repr_v",
]);

// design §4-3: "= != < <= > >= IN BETWEEN LIKE" のみ。
export const RESEARCH_QUERY_OPERATORS: ReadonlySet<string> = new Set([
  "=",
  "!=",
  "<",
  "<=",
  ">",
  ">=",
  "IN",
  "BETWEEN",
  "LIKE",
]);

// 1クエリの上限行数(design §4-3「LIMIT必須」)。定数は1箇所のみ(observation-constants.ts
// の流儀=「Scatter these as literals across route files and they drift; keep them here」
// と同じ考え方)。
export const RESEARCH_QUERY_LIMIT_MAX = 10_000;
export const RESEARCH_QUERY_LIMIT_DEFAULT = 1_000;

// apps/api/src/sandbox-routes.ts と同じエラーコード(新エラーコードを増やさない —
// design §4-3 の指示どおり)。
export const WHITELIST_VIOLATION_CODE = "WHITELIST_VIOLATION";

export class WhitelistViolationError extends Error {
  readonly code = WHITELIST_VIOLATION_CODE;
  constructor(message: string) {
    super(message);
    this.name = "WhitelistViolationError";
  }
}
