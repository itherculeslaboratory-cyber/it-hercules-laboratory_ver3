// GENERATED FILE — do not edit by hand.
// source: schemas/events/gov-flag.schema.json
// title: Governance flag data (ihl.gov.flag.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 不使用フラグイベント ihl.gov.flag.v1 の data 部（GOV-09）。Truth キー truth/ihl.gov.flag.v1/<target_id>/<flag_id>.json に append-only（R2 DELETE なし＝論理無効化）。付与時に target_owner へ grantKarmaCountIncrease(steps=GOV_FLAG_COUNT_STEPS=10) を課す。操作は operator の明示操作時のみ append（自動 poll しない・行政命令服従判断は人間ゲート V3-AIP-31）。
 */
export interface GovFlag {
  /**
   * フラグの一意キー（ULID）。
   */
  flag_id: string;
  /**
   * 行政指摘を記録した operator の actor_id（セッション principal 強制・V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 不使用対象の種別。
   */
  target_type: "listing" | "data" | "image";
  /**
   * 不使用対象の一意キー。
   */
  target_id: string;
  /**
   * Δcount+10 を課される actor_id（対象の所有者）。
   */
  target_owner: string;
  /**
   * 理由（任意）。
   */
  reason?: string;
  /**
   * フラグ時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
