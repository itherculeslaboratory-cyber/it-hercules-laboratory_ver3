// GENERATED FILE — do not edit by hand.
// source: schemas/common/lineage-meta.schema.json
// title: Lineage metadata (FND-15 shared type)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 系譜メタ共用型（イベントではない・FND-15）。決定論ヘルパ computeLineageMeta が生成する再現可能な系譜足場。envelope の provenance 拡張・frozen/provenance（run_id/schema_version/input_hash）とは別層で両立付与する。全 hash は SHA-256 hex（64文字）。値なしフィールドは省略（null/空文字禁止・AI ファースト規約）。
 */
export interface LineageMeta {
  /**
   * このノードの一意キー（ULID）。
   */
  uuid: string;
  /**
   * SHA-256((parent?.lineage_hash ?? GENESIS_HASH) + content_hash) の hex。系譜の連鎖ハッシュ。
   */
  lineage_hash: string;
  /**
   * SHA-256(canonicalJson(content)) の hex。内容の決定論ハッシュ。
   */
  content_hash: string;
  /**
   * 世代番号。root=0、子=親+1。
   */
  generation: number;
  /**
   * 親ノードの uuid（root は省略）。
   */
  parent_uuid?: string;
  /**
   * root から親までの uuid 列（root は空配列相当だが値なしは省略）。
   */
  ancestor_chain?: string[];
  /**
   * embedding 派生の意味ハッシュ（既定 OFF・通常省略）。
   */
  semantic_hash?: string;
}
