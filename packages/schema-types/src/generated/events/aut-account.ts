// GENERATED FILE — do not edit by hand.
// source: schemas/events/aut-account.schema.json
// title: Account creation marker (ihl.aut.account.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * V3-AUT-09: 独立サインアップ画面を持たず、ログイン画面のマジックリンク（または数字コード・dev-login）初回検証時にオープン登録としてR2上に作成するアカウント行。Truth キー truth/ihl.aut.account.v1/<actor_id>.json に put-if-absent（初回のみ作成・2回目以降の検証は既存キーとの衝突=409を無視する idempotent no-op）。PII は持たない（email はここに保存しない・actor_id は deriveActorId のハッシュ）。
 */
export interface AutAccount {
  /**
   * 初回検証で成立した本人の actor_id（キー本体にも使う）。
   */
  actor_id: string;
  /**
   * 初回検証時刻（RFC3339・以後は不変=このアカウント行は再書込されない）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
