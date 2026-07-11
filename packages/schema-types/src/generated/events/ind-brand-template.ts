// GENERATED FILE — do not edit by hand.
// source: schemas/events/ind-brand-template.schema.json
// title: Individual Brand Template data (ihl.ind.brand_template.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 命名ブランドテンプレの append-only イベントの data 部。Truth キー truth/ihl.ind.brand_template.v1/<brand_template_id>-<ulid>.json。論理削除は新 record を active=false で append（UPDATE/DELETE 禁止・不変条項③）。過去の name_event は無効化後も再現可能。
 */
export interface IndBrandTemplate {
  /**
   * ブランドテンプレの一意キー。
   */
  brand_template_id: string;
  /**
   * 命名パターン（連番・接頭辞等のテンプレ文字列）。
   */
  pattern: string;
  /**
   * 有効フラグ。false で論理削除（新 record を append）。
   */
  active: boolean;
  /**
   * 作成者の actor_id（V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 作成／更新時刻（RFC3339）。
   */
  created_at: string;
}
