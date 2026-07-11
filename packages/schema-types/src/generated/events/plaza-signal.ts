// GENERATED FILE — do not edit by hand.
// source: schemas/events/plaza-signal.schema.json
// title: Plaza signal data (ihl.plaza.signal.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 自然淘汰シグナルイベント ihl.plaza.signal.v1 の data 部（BBS-03/GOV-23）。Truth キー truth/ihl.plaza.signal.v1/<target_type>/<target_id>/<signal_id>.json に append-only。projectRanking が RANKING_WEIGHTS で like/use/retain を加重合算し都度ランキング投影（利用率→ランキング・GOV-23 自然淘汰）。
 */
export interface PlazaSignal {
  /**
   * シグナルの一意キー（ULID）。
   */
  signal_id: string;
  /**
   * シグナル発信者の actor_id（セッション principal 強制・V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 対象種別（fork/screen/component 等）。
   */
  target_type: string;
  /**
   * 対象の一意キー。
   */
  target_id: string;
  /**
   * シグナル種別（いいね/利用/継続・RANKING_WEIGHTS で加重）。
   */
  signal: "like" | "use" | "retain";
  /**
   * シグナル時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
