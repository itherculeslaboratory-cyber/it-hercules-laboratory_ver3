// GENERATED FILE — do not edit by hand.
// source: schemas/events/ui-vote.schema.json
// title: UI vote event (ihl.ui.vote.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * テンプレ/パックへの like・platinum 投票の append-only イベント。POST /events 経由（新 route を作らない・matrix 57 行凍結）。Truth キー truth/ihl.ui.vote.v1/<vote_id>.json。1 actor / 1 target / 1 kind の冪等は投影 projectTemplateVotes の distinct (actor,target,kind) dedup で担保（storage 409 に依存しない・批評家修正2）。
 */
export interface UiVote {
  /**
   * 投票イベントの一意キー（envelope.id=ULID 由来・冪等キーではない）。
   */
  vote_id: string;
  /**
   * 投票者の actor_id（本人スコープ V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 投票対象の種別。
   */
  target_kind: "template" | "pack";
  /**
   * 投票対象（template_id または pack_id）。
   */
  target_id: string;
  /**
   * 投票種別。
   */
  vote_kind: "like" | "platinum";
  /**
   * 発生時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
