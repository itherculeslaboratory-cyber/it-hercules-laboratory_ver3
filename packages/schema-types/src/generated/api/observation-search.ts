// GENERATED FILE — do not edit by hand.
// source: schemas/api/observation-search.schema.json
// title: POST /api/v1/observation/search Request
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 類似検索の決定論梯子（V3-OBS-10 / CL-08・design-c3 §1）のリクエスト契約。3 段: ① whitelist（domain/species/subject_ref の完全一致 filter）→ ② subset（measurements の決定論レンジ filter）→ ③ embedding（query_capture_id または query_vector の 384 次元 cosine ランキング・凍結 cosineSimilarity 使用）。どの段まで使ったかは応答 ladder_stage に返す。常駐 index / FAISS / LLM は使わない（不変条項①）。
 */
export interface ObservationSearch {
  /**
   * whitelist 段: 観測ドメインの完全一致 filter（V3-OBS-01 の 5 分岐）。任意。
   */
  domain?: "biology" | "mineral" | "digital" | "place" | "custom";
  /**
   * whitelist 段: capture.species_candidate の完全一致 filter。任意。
   */
  species?: string;
  /**
   * whitelist 段: capture.subject_ref の完全一致 filter（'individual/<id>' 形式）。任意。
   */
  subject_ref?: string;
  /**
   * subset 段: 計測値レンジの決定論 filter。各要素の item に一致する計測値が [min,max] に収まる capture のみ残す。任意。
   */
  measurements?: {
    /**
     * 計測項目名（capture.measurements[].item に一致）。
     */
    item: string;
    /**
     * 下限（含む・任意）。
     */
    min?: number;
    /**
     * 上限（含む・任意）。
     */
    max?: number;
  }[];
  /**
   * embedding 段: この capture の埋め込みベクトルを問い合わせベクトルにする（R2 manifest+embeddings.bin 読取投影）。query_vector と併用時は query_vector を優先。任意。
   */
  query_capture_id?: string;
  /**
   * embedding 段: 384 次元の問い合わせベクトル直指定。長さ != 384 は 400。任意。
   */
  query_vector?: number[];
  /**
   * 返す件数の上限（既定 10）。
   */
  top_k?: number;
}
