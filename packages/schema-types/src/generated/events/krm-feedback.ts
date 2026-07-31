// GENERATED FILE — do not edit by hand.
// source: schemas/events/krm-feedback.schema.json
// title: KRM feedback event (ihl.krm.feedback.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 取引に紐づかない一般ユーザー評価の append-only イベント（V3-KRM-22②）。Truth キー truth/ihl.krm.feedback.v1/<feedback_id>.json。×/-/◯(grade)+理由(reason)+対象(target_actor_id)を記録する。「decision/creation/style model の自動更新」は外部AIではなく match-preference.schema.json と同型の学習率つき重みベクトル更新（純関数）で行う（design19 T1-1 案A）。取引(listing)に紐づく評価は別要件(V3-MKT-27・mkt-rating.schema.json)であり、本スキーマと混同しない。
 */
export interface KrmFeedback {
  /**
   * フィードバックイベントの一意キー（ULID）。
   */
  feedback_id: string;
  /**
   * 評価者の actor_id（セッション principal 強制・V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 評価対象の actor_id。
   */
  target_actor_id: string;
  /**
   * ×/-/◯ の3値評価（mkt-rating.schema.json の grade 語彙と揃える）。
   */
  grade: "bad" | "normal" | "good";
  /**
   * 評価理由。grade=bad のとき必須（if/then）。
   */
  reason?: string;
  /**
   * 発生時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
