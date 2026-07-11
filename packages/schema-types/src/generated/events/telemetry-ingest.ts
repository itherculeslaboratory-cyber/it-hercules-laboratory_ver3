// GENERATED FILE — do not edit by hand.
// source: schemas/events/telemetry-ingest.schema.json
// title: Telemetry ingest source event (ihl.src.telemetry.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * テレメトリ取り込みイベント（バケット集約後）ihl.src.telemetry.v1 の data 部。Truth キー truth/ihl.src.telemetry.v1/<device_id>-<bucket_start_ms>.json。Tier B。putEventAt の put-if-absent が冪等マージを storage 層で保証（inserted=written / 409=skipped_duplicate）。real parquet は defer。値なしフィールドは省略（null/空文字禁止）。
 */
export interface TelemetryIngest {
  /**
   * テレメトリ発生デバイスの一意キー。
   */
  device_id: string;
  /**
   * 集約バケット開始時刻（Unix epoch ミリ秒）。冪等キーの一部。
   */
  bucket_start_ms: number;
  /**
   * 計測指標名（例 temperature・humidity）。
   */
  metric: string;
  /**
   * バケット内の平均値。
   */
  mean: number;
  /**
   * バケットに集約された元行数。
   */
  count: number;
  /**
   * 元行の粒度（ミリ秒。1 分粒度なら 60000）。
   */
  source_granularity_ms: number;
  /**
   * イベント型バージョン（ihl.src.telemetry.v1）。
   */
  schema_version: string;
}
