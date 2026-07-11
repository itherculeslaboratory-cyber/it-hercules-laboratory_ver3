// GENERATED FILE — do not edit by hand.
// source: schemas/events/obs-device.schema.json
// title: Observation Device data (ihl.obs.device.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 観測機器（センサ/カメラ等）登録の append-only イベントの data 部。Truth キー truth/ihl.obs.device.v1/<device_id>.json。機器は placement（置き場所）に紐付ける。個体への直接紐付けは route が 400 で拒否（本スキーマは個体参照フィールドを持たない）。API キーは暗号化保存（api_key_ciphertext・平文非保持）、実鍵投入は人間ゲート（後波）。
 */
export interface ObsDevice {
  /**
   * 機器の一意キー。
   */
  device_id: string;
  /**
   * 紐付け先の置き場所参照（任意・個体ではなく placement のみ）。
   */
  placement_ref?: string;
  /**
   * 機器プロバイダ（SwitchBot 等）。
   */
  provider: string;
  /**
   * 表示名（raw device ID は非表示・display_name のみ露出）。
   */
  display_name: string;
  /**
   * API キーの暗号文（平文は保持しない・任意）。
   */
  api_key_ciphertext?: string;
  /**
   * 運用開始日（日付のみ・任意）。
   */
  started_on?: string;
  /**
   * 登録者の actor_id（V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 登録時刻（RFC3339・任意）。
   */
  created_at?: string;
}
