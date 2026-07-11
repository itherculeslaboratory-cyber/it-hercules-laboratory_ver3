// GENERATED FILE — do not edit by hand.
// source: schemas/events/theme-pack.schema.json
// title: Theme pack event (ihl.theme.pack.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * テーマパック（色トークンのみ・11 キー）の append-only イベント。Truth キー truth/ihl.theme.pack.v1/<pack_id>.json。fork は parent_pack_id 付き追記で built-in（minimal-light/minimal-dark）まで系譜連結（V3-UIX-14/16）。radius/tap/motion/font/fs-* は全画面共通で pack 上書き対象外。
 */
export interface ThemePack {
  /**
   * パックの一意キー（envelope.id=ULID 由来）。
   */
  pack_id: string;
  /**
   * 作成者の actor_id（本人スコープ V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 表示名。
   */
  name: string;
  /**
   * 配色モード。
   */
  mode: "light" | "dark";
  /**
   * fork 元パック ID（built-in slug または ULID・任意・系譜終端）。
   */
  parent_pack_id?: string;
  /**
   * 色トークン 11 キー（fork 対象＝色文明のみ）。
   */
  tokens: {
    bg: string;
    surface: string;
    "surface-2": string;
    text: string;
    "text-muted": string;
    border: string;
    primary: string;
    "primary-text": string;
    focus: string;
    danger: string;
    "danger-bg": string;
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
