// GENERATED FILE — do not edit by hand.
// source: schemas/events/occupancy.schema.json
// title: Occupancy source event (ihl.src.occupancy.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 在住（占有）イベント ihl.src.occupancy.v1 の data 部。Truth キー truth/ihl.src.occupancy.v1/<occupancy_id>.json（phase 無し・単発記録・既存互換）または truth/ihl.src.occupancy.v1/<occupancy_id>-<phase>.json（phase∈{start,end}・移動の2相記録・device-binding と同型）。Tier A INSERT ONLY。値なしフィールドは省略（null/空文字禁止）。
 */
export interface Occupancy {
  /**
   * 在住レコードの一意キー（ULID）。
   */
  occupancy_id: string;
  /**
   * 登録者の actor_id（セッション principal 強制・V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 在住先プレイスメントの一意キー。
   */
  placement_id: string;
  /**
   * 在住対象（個体等）への参照。
   */
  subject_ref: string;
  /**
   * 在住の発効時刻（RFC3339）。
   */
  effective_at: string;
  /**
   * 移動（1 item = 旧 placement の end + 新 placement の start）を束ねる相（任意・additive）。省略時は phase 無しの単発記録（既存互換）。
   */
  phase?: "start" | "end";
  /**
   * イベント型バージョン（ihl.src.occupancy.v1）。
   */
  schema_version: string;
}
