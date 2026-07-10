// GENERATED FILE — do not edit by hand.
// source: schemas/frozen/tag-event.schema.json
// title: Tag Event (CL-13)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 既存タグイベントは append-only tag_event。集約ビューの前提を変えると既存タグ集計が不整合（要件定義書 CL-13 / V3-OBS-63 / FR-DATA-15）。集約（aggregate）ビューは投影層で再生成する派生物であり Truth ではない。ver2 schemas/events/tag_event.schema.yaml の形状を凍結。
 */
export interface TagEvent {
  tag_event_id: string;
  target_type: "capture" | "individual" | "cross" | "measurement";
  target_id: string;
  tag: string;
  /**
   * タグ種別。enum 正本は schemas/dictionaries/tag_type.yaml（ver2 では enum_ref 弱参照）。厳格 enum 値の展開は C1 で codegen 時に確定。
   */
  tag_type: string;
  /**
   * タグ操作。enum 正本は schemas/dictionaries/tag_action.yaml。C1 で codegen 展開。
   */
  action: string;
  /**
   * タグ付与元。enum 正本は schemas/dictionaries/source_type.yaml。C1 で codegen 展開。
   */
  source_type: string;
  source_id?: string;
  confidence?: number;
  reason?: string;
  evidence_ref?: string;
  model_name?: string;
  model_version?: string;
  run_id?: string;
  created_at: string;
  schema_version: number;
}
