// GENERATED FILE — do not edit by hand.
// source: schemas/events/obs-cadence.schema.json
// title: Observation Cadence declaration (ihl.obs.cadence.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * V3-OBS-75(D-2)提出ペース宣言。append-only。1つの stream_kind/subject_id の組に複数の宣言が積まれた場合、新しい宣言は古い宣言を『上書き』せず、それぞれの宣言が有効だった期間の穴の判定に個別に使われる(遡及宣言不採用)。Truth キー truth/ihl.obs.cadence.v1/<subject_id>-<ulid>.json。穴そのものはここには保存しない(読み出し時に導出。apps/api/src/cadence-routes.ts)。
 */
export interface ObsCadence {
  /**
   * 宣言の一意キー。
   */
  cadence_id: string;
  /**
   * 宣言対象のストリーム種別(例: env_telemetry / individual_observation)。閉じた enum ではない — 新しいストリーム種別の追加にスキーマ変更を要求しない。
   */
  stream_kind: string;
  /**
   * 宣言対象の識別子(device_id / placement_id / individual_id 等、stream_kind に応じた対象)。
   */
  subject_id: string;
  /**
   * 期待する提出間隔(秒)。
   */
  expected_interval_s: number;
  /**
   * 許容誤差(秒・任意)。省略時は0(厳格)として扱う(cadence-routes.ts)。
   */
  tolerance_s?: number;
  /**
   * 宣言が適用され始める時刻(RFC3339・申告値)。★遡及宣言不採用: 実際の適用開始は effective_from とこの宣言イベント自身の received_at の遅い方(cadence-routes.ts)。過去に effective_from を遡らせても、既に経過した期間の穴の判定はこの宣言では変わらない。
   */
  effective_from: string;
  /**
   * 宣言者の actor_id(V3-AUT-17)。
   */
  actor_id: string;
  /**
   * 記録時刻(RFC3339・任意)。
   */
  created_at?: string;
}
