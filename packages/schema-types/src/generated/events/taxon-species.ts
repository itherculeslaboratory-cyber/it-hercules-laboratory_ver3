// GENERATED FILE — do not edit by hand.
// source: schemas/events/taxon-species.schema.json
// title: Taxon Species data (ihl.taxon.species.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 種マスタの append-only イベントの data 部。Truth キー truth/ihl.taxon.species.v1/<species_id>.json（put-if-absent 409）。fork（forked_from）で系譜継承（フォーク文化 不変条項②）。平均サイズ／体重／市場平均価格は listing・capture からの投影で都度再計算（常駐 DB 禁止・不変条項①）。
 */
export interface TaxonSpecies {
  /**
   * 種の一意キー。
   */
  species_id: string;
  /**
   * 種名（学名または通称）。
   */
  name: string;
  /**
   * 系統（分類上位・任意）。
   */
  lineage?: string;
  /**
   * fork 元の species_id（フォーク系譜・任意）。
   */
  forked_from?: string;
  /**
   * 作成者の actor_id（V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 作成時刻（RFC3339・任意）。
   */
  created_at?: string;
}
