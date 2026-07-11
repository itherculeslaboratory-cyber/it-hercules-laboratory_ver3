// GENERATED FILE — do not edit by hand.
// source: schemas/events/taxon-morph.schema.json
// title: Taxon Morph data (ihl.taxon.morph.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 形態（モルフ）マスタの append-only イベントの data 部。Truth キー truth/ihl.taxon.morph.v1/<morph_id>.json（put-if-absent 409）。fork（forked_from）で系譜継承（フォーク文化 不変条項②）。
 */
export interface TaxonMorph {
  /**
   * 形態の一意キー。
   */
  morph_id: string;
  /**
   * 所属する種の species_id。
   */
  species_id: string;
  /**
   * 形態名。
   */
  name: string;
  /**
   * fork 元の morph_id（フォーク系譜・任意）。
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
