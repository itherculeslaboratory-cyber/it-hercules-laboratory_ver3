// GENERATED FILE — do not edit by hand.
// source: schemas/events/mkt-listing-flag.schema.json
// title: Market listing illegal-listing flag (ihl.mkt.listing_flag.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 違法/規約違反疑いの出品への指摘イベント(V3-GOV-35・round-15拡張)。Truth キー truth/ihl.mkt.listing_flag.v1/<listing_id>/<flag_id>.json に append-only。scope=user は同国ユーザー間限定(route が判定)・5件以上の active flag(action=flag が最新の (actor,listing) ペア数)で非表示。scope=government は operator/admin ロール限定(requireRole)で近似範囲(同一出品者の全出品)をまるごと停止する。action=withdraw で本人の指摘を LWW 撤回できる(market-block と同型)。
 */
export interface MktListingFlag {
  /**
   * 指摘イベントの一意キー(ULID)。
   */
  flag_id: string;
  /**
   * 指摘した本人の actor_id(セッション principal 強制・V3-AUT-17)。
   */
  actor_id: string;
  /**
   * 指摘対象の出品 listing_id。
   */
  listing_id: string;
  /**
   * 対象出品の出品者 actor_id(既存の指摘カルマΔcountルールの対象)。
   */
  target_owner: string;
  /**
   * 指摘 or 本人による撤回(LWW・market-block と同型)。
   */
  action: "flag" | "withdraw";
  /**
   * user=通常ユーザー指摘(同国間のみ・route が判定)/ government=国やそれに準ずる立場からの指摘(requireRole operator/admin・近似範囲まるごと停止)。省略時 user。
   */
  scope?: "user" | "government";
  /**
   * 理由(任意)。
   */
  reason?: string;
  /**
   * 発生時刻(RFC3339)。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
