// GENERATED FILE — do not edit by hand.
// source: schemas/events/aut-github-link.schema.json
// title: GitHub account link (ihl.aut.github_link.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * GitHubユーザー名とIHLユーザー(actor_id)の対応表 append-only 行（V3-AUT-38・bridgeplan J1-6で設計確定）。Truth キー truth/ihl.aut.github_link.v1/<github_login>/<link_id>.json（login prefixで全件走査を回避）。既存の汎用マッピング型は0件だったため新規1本（前波 R0731-7b0c89 の実物確認で確定済み）。mapping未設定の github_login からのwebhookはanonymousプールへ入れる（本スキーマにレコードが無い＝未マッピングと判定・route側の責務）。
 */
export interface AutGithubLink {
  /**
   * このリンク行の一意キー（ULID）。
   */
  link_id: string;
  /**
   * GitHub側のユーザー名（webhook sender.login と同一値・Truth キーのprefix）。
   */
  github_login: string;
  /**
   * 対応付け先のIHL actor_id。
   */
  actor_id: string;
  /**
   * この対応付けを確定した actor_id（本人確定操作・セッション principal 強制・V3-AUT-17・任意=actor_id本人操作なら省略可）。
   */
  linked_by?: string;
  /**
   * 対応付け確定時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
