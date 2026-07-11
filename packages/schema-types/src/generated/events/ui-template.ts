// GENERATED FILE — do not edit by hand.
// source: schemas/events/ui-template.schema.json
// title: UI template event (ihl.ui.template.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * UI/OS テンプレ（UI をノードとして保存/fork）の append-only イベント。Truth キー truth/ihl.ui.template.v1/<template_id>.json。fork は parent_template_id 付き追記で系譜連結、projectTemplateVotes が like/platinum 集計と採用候補判定（V3-UIX-45/17）。
 */
export interface UiTemplate {
  /**
   * テンプレの一意キー（envelope.id=ULID 由来）。
   */
  template_id: string;
  /**
   * 作成者の actor_id（本人スコープ V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 表示名。
   */
  name: string;
  /**
   * テンプレ推奨度。
   */
  level: "default" | "recommended" | "custom";
  /**
   * fork 元テンプレ ID（任意・系譜連結）。
   */
  parent_template_id?: string;
  /**
   * 紐づく theme-pack ID（任意）。
   */
  theme_pack_id?: string;
  /**
   * screen_id → ScreenDef 部分の上書き（任意）。
   */
  screen_overrides?: {};
  /**
   * 共有メタ（著者名等）。
   */
  social: {
    /**
     * 表示著者名（任意）。
     */
    author_name?: string;
  };
  /**
   * 発生時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
