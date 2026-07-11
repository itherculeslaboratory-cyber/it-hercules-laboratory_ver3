// GENERATED FILE — do not edit by hand.
// source: schemas/ai-profile.schema.json
// title: AI feature profile (差替可能プロファイル)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * AI 機能ごとの差替可能プロファイル。provider/model/compute_tier を機能単位で持ち替える。BYOK のみ（サーバ既定 API 鍵フィールドは持たない＝V3-SEC・LLM 既定 OFF＝不変条項①）。compute_tier は UI ラベル 低/中/高/最高（V3-AIP-40）。
 */
export interface AiProfile {
  /**
   * 対象 AI 機能の識別子（image-analysis / rag / newspaper / translation / market など）。
   */
  feature_id: string;
  /**
   * モデル提供者。
   */
  provider: string;
  /**
   * モデル名。
   */
  model: string;
  /**
   * 計算資源目安（UI 低/中/高/最高）。
   */
  compute_tier: "low" | "medium" | "high" | "max";
  /**
   * Bring Your Own Key。既定 true（サーバは鍵を保持しない）。
   */
  byok: boolean;
  /**
   * 対応機能タグ（任意）。
   */
  capabilities?: string[];
  /**
   * コスト目安（任意）。
   */
  cost?: {};
  /**
   * レイテンシ目安（任意）。
   */
  latency?: string;
  /**
   * RAG 設定（任意）。
   */
  rag?: {};
  /**
   * 既定プロンプト（ユーザー編集可・任意）。
   */
  prompt?: string;
}
