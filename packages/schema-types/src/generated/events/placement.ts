// GENERATED FILE — do not edit by hand.
// source: schemas/events/placement.schema.json
// title: Placement source event (ihl.src.placement.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 設置場所（プレイスメント）登録イベント ihl.src.placement.v1 の data 部。Truth キー truth/ihl.src.placement.v1/<placement_id>.json。Tier A INSERT ONLY。値なしフィールドは省略（null/空文字禁止）。
 */
export interface Placement {
  /**
   * プレイスメントの一意キー（ULID）。
   */
  placement_id: string;
  /**
   * 登録者の actor_id（セッション principal 強制・V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 設置場所の表示ラベル。
   */
  label: string;
  /**
   * 登録時刻（RFC3339）。
   */
  created_at: string;
  /**
   * イベント型バージョン（ihl.src.placement.v1）。
   */
  schema_version: string;
}
