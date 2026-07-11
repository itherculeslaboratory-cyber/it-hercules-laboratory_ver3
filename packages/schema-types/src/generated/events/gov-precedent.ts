// GENERATED FILE — do not edit by hand.
// source: schemas/events/gov-precedent.schema.json
// title: Governance precedent data (ihl.gov.precedent.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 判例イベント ihl.gov.precedent.v1 の data 部（GOV-12）。dispute close 時に append。Truth キー truth/ihl.gov.precedent.v1/<precedent_id>.json（R2 DELETE なし）。title/summary/tags は close 時に人間 closer が供給（LLM 既定 OFF＝自動生成しない）。category は元 dispute から継承。projectPrecedents が全文/タグ検索を都度投影。CiteRef(type=precedent)で引用可能。
 */
export interface GovPrecedent {
  /**
   * 判例の一意キー（ULID）。
   */
  precedent_id: string;
  /**
   * 元となった紛争キー。
   */
  dispute_id: string;
  /**
   * 判例タイトル（close 時に人間 closer が供給）。
   */
  title: string;
  /**
   * 判例カテゴリ（元 dispute の category を継承）。
   */
  category: "market" | "board" | "bugfix";
  /**
   * 判例要旨（close 時に人間 closer が供給・LLM 自動生成しない）。
   */
  summary: string;
  /**
   * 文化差ガイド（任意）。
   */
  culture_guide?: string;
  /**
   * 検索タグ群（任意・projectPrecedents の tag フィルタ対象）。
   */
  tags?: string[];
  /**
   * 判例確定時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
