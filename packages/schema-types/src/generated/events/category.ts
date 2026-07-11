// GENERATED FILE — do not edit by hand.
// source: schemas/events/category.schema.json
// title: Research category (ihl.research.category.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * ユーザー追加可能な学術分類階層（PPR-13）。Truth キー truth/ihl.research.category.v1/<category_id>.json。亜種・重複防止のため domain を必須とし、parent_category_id で木構成。categoryTree は都度再計算投影。
 */
export interface Category {
  /**
   * 分類の一意キー（storage key の <category_id>）。
   */
  category_id: string;
  /**
   * 追加者の actor_id（セッション principal 強制・V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 分類ラベル。
   */
  label: string;
  /**
   * 分野（重複防止のため必須・DOMAIN_API_MAP のキー系）。
   */
  domain: string;
  /**
   * 親分類 category_id（木構成・任意＝ルートは無し）。
   */
  parent_category_id?: string;
  /**
   * 発生時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版（例: '1'）。
   */
  schema_version: string;
}
