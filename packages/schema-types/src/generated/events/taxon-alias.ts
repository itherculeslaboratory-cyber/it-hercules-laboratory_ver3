// GENERATED FILE — do not edit by hand.
// source: schemas/events/taxon-alias.schema.json
// title: Taxon Alias data (ihl.taxon.alias.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 種の別名（エイリアス）統合の append-only イベントの data 部。人間承認済みのもののみ append（AI が自動統合しない・人間ゲート文化 不変条項④）。Truth キー truth/ihl.taxon.alias.v1/<alias_id>.json。候補提示（aliasCandidates）は Levenshtein/Jaro-Winkler の決定論投影で別レイヤ。
 */
export interface TaxonAlias {
  /**
   * エイリアスの一意キー。
   */
  alias_id: string;
  /**
   * 統合先の正規種 species_id。
   */
  canonical_species_id: string;
  /**
   * 別名文字列（表記ゆれ・通称）。
   */
  alias_text: string;
  /**
   * 承認した人間の actor_id（人間承認済みの証跡）。
   */
  approved_by: string;
  /**
   * 記録者の actor_id（V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 承認時刻（RFC3339・任意）。
   */
  created_at?: string;
}
