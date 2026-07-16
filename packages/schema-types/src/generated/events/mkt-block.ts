// GENERATED FILE — do not edit by hand.
// source: schemas/events/mkt-block.schema.json
// title: Market Block relation event (ihl.mkt.block.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * ブロック関係の append-only イベント(V3-MKT-61)。既存 V3-AUT-28 のブロックリストとは別に、マーケット取引ガード専用の投影として持つ(掲示板/議論は不干渉・取引のみ遮断)。Truth キー truth/ihl.mkt.block.v1/<block_id>.json。GET/取引 route は (blocker,blocked) ペアの最新 action で last-write-wins 投影し unblock を表現する(UPDATE/DELETE 不使用・不変条項③)。
 */
export interface MktBlock {
  /**
   * ブロックイベントの一意キー(ULID)。
   */
  block_id: string;
  /**
   * ブロックした側の actor_id(セッション principal 強制・V3-AUT-17)。
   */
  actor_id: string;
  /**
   * ブロックされた側の actor_id。
   */
  blocked_actor_id: string;
  /**
   * block=ブロック追加・unblock=解除。ペア単位で最新の action が投影の正(LWW)。
   */
  action: "block" | "unblock";
  /**
   * 記録時刻(RFC3339)。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
