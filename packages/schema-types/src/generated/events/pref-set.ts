// GENERATED FILE — do not edit by hand.
// source: schemas/events/pref-set.schema.json
// title: User preference set event (ihl.pref.set.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 利用者の設定（locale / theme-pack / UI template / reduced-motion 上書き）の append-only イベント。Truth キー truth/ihl.pref.set.v1/<pref_set_id>.json。projectPreferences が actor 一致を created_at/ULID で last-write-wins に畳み込み（UPDATE でなく追記＝不変条項③）。
 */
export interface PrefSet {
  /**
   * 設定イベントの一意キー（envelope.id=ULID 由来・冪等キーではない）。
   */
  pref_set_id: string;
  /**
   * 設定した本人の actor_id（本人スコープ V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 選択 locale（BCP-47・任意・未設定は DEFAULT_LOCALE=ja）。
   */
  locale?: string;
  /**
   * 選択 theme-pack ID（built-in slug または fork ULID・任意）。
   */
  theme_pack_id?: string;
  /**
   * 選択 UI template ID（任意）。
   */
  template_id?: string;
  /**
   * モーション低減の明示上書き（任意・system=OS 追従）。
   */
  reduced_motion_override?: "system" | "reduce" | "no-preference";
  /**
   * 発生時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
