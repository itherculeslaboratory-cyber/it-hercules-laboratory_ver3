// GENERATED FILE — do not edit by hand.
// source: schemas/defs/ai-view.schema.json
// title: AI two-layer view (human_view + machine_view + tags)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 二層ビュー再利用 def。他クラスタの要約/知識スキーマが $ref する。human_view は人間向け要約 1 本、machine_view は AI 向け構造化ビュー、tags は system/ai/user の 3 層（V3-AIP-45）。
 */
export interface AiView {
  /**
   * 人間向け要約 1 本。
   */
  human_view: string;
  machine_view: {
    /**
     * H2 見出し単位のチャンク。
     */
    sections: string[];
    /**
     * 要点リスト。
     */
    keypoints: string[];
    /**
     * 抽出エンティティ（任意）。
     */
    entities?: {
      /**
       * エンティティ名。
       */
      name: string;
      /**
       * エンティティ種別（任意）。
       */
      type?: string;
    }[];
    /**
     * トピック（任意）。
     */
    topics?: string[];
    /**
     * RAG 投入用の連結本文（任意）。
     */
    rag_chunk?: string;
    /**
     * 重要度スコア（0〜1・任意）。
     */
    importance?: number;
  };
  tags: {
    /**
     * システム付与タグ。
     */
    system: string[];
    /**
     * AI 付与タグ。
     */
    ai: string[];
    /**
     * ユーザー付与タグ。
     */
    user: string[];
  };
}
