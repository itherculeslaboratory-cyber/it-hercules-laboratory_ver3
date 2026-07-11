// GENERATED FILE — do not edit by hand.
// source: schemas/events/device-binding.schema.json
// title: Device binding source event (ihl.src.device_binding.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * デバイス紐付けイベント ihl.src.device_binding.v1 の data 部。Truth キー truth/ihl.src.device_binding.v1/<binding_id>-<phase>.json。phase∈{start,end}。start は同一 device_id の open binding が有れば route が 409。end は新 INSERT（UPDATE しない）。値なしフィールドは省略（null/空文字禁止）。
 */
export interface DeviceBinding {
  /**
   * 紐付けの一意キー（ULID）。start/end で共有。
   */
  binding_id: string;
  /**
   * 操作者の actor_id（セッション principal 強制・V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 紐付け対象デバイスの一意キー。
   */
  device_id: string;
  /**
   * 紐付け先プレイスメントの一意キー。
   */
  placement_id: string;
  /**
   * 紐付けの相。start=開始・end=終了（新 INSERT）。
   */
  phase: "start" | "end";
  /**
   * 対象個体等への参照（任意・値なしは省略）。
   */
  subject_ref?: string;
  /**
   * この相の発効時刻（RFC3339）。
   */
  effective_at: string;
  /**
   * イベント型バージョン（ihl.src.device_binding.v1）。
   */
  schema_version: string;
}
