// GENERATED FILE — do not edit by hand.
// source: schemas/events/sec-key-bundle-recovery.schema.json
// title: One-time key bundle recovery code (ihl.sec.key_bundle_recovery.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * V3-SEC-57: オフライン1回限りリカバリコード(1Password/Bitwarden型)。サーバはコードの平文を一切保持せずSHA-256ハッシュのみ保管する(action=issue時に発行・平文はレスポンスで1回だけ返し永続化しない)。action=consumeは1回限りの消費マーク(append-only・同一recovery_idへの2度目のconsumeはconflict=再消費不可)。Truth キー truth/ihl.sec.key_bundle_recovery.v1/<actor_id>/<recovery_id>-<action>.json。
 */
export interface SecKeyBundleRecovery {
  /**
   * リカバリコードの一意キー(ULID推奨)。
   */
  recovery_id: string;
  /**
   * 本人 actor_id(セッション principal 強制・V3-AUT-17)。
   */
  actor_id: string;
  /**
   * SHA-256(コード平文)。平文自体はサーバに保管しない(発行時のレスポンスでのみ1回提示)。
   */
  code_hash: string;
  /**
   * issue=発行時記録 / consume=1回限りの消費マーク。
   */
  action: "issue" | "consume";
  /**
   * event 時刻(RFC3339)。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
