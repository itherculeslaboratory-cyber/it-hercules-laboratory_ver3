// GENERATED FILE — do not edit by hand.
// source: schemas/events/content.schema.json
// title: Research CMS content (ihl.research.content.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 共通 CMS 基盤の単一イベント（WIK-16）。論文/記事/ブログ/チャットログ/新聞を content_type enum で兼用し、エンティティ乱立を避ける。Truth キー truth/ihl.research.content.v1/<content_id>.json に append。投稿=即検索可能は prefix scan 投影で満たす（維持型二次インデックス不要・不変条項①）。paper のみ sections/conditions/claims/measurements を持つ。observed_at は data 側の観測時刻で committed_at=envelope.time と分離（PPR-09）。value_origin は frozen provenance 9 値を参照（再定義しない・CL-02 不変）。
 */
export interface Content {
  /**
   * content の一意キー（storage key の <content_id>）。
   */
  content_id: string;
  /**
   * 投稿者の actor_id（セッション principal 強制・V3-AUT-17）。
   */
  actor_id: string;
  /**
   * コンテンツ種別（単一イベント兼用・WIK-16）。
   */
  content_type: "article" | "blog" | "paper" | "chat_log" | "newspaper";
  /**
   * タイトル。
   */
  title: string;
  /**
   * 本文（article/blog/chat_log）。Phase1 は LaTeX 禁止＝\ と $ を含めない（LATEX_FORBIDDEN・PPR-03）。
   */
  body_markdown?: string;
  /**
   * 引用した論文 content_id（WIK-16・正本は citation イベント）。
   */
  cited_paper_ids?: string[];
  /**
   * 引用したセッション ID（WIK-16・正本は citation イベント）。
   */
  cited_session_ids?: string[];
  /**
   * 束ねる Project の集約キー（PPR-16）。
   */
  project_id?: string;
  /**
   * ブログ個体紐付け（任意）。
   */
  individual_id?: string;
  /**
   * 文体スキン参照（構造/文体分離＝content に文体を埋めない・PPR-03）。
   */
  skin_id?: string;
  /**
   * canonical SHA-256（定義のみ・v1 は未計算＝配線は v2）。
   */
  client_content_digest?: string;
  /**
   * 観測時刻（PPR-09・committed_at=envelope.time と分離した data 側の時刻）。
   */
  observed_at?: string;
  /**
   * システムタグの初期スナップショット（正本は tag-event・3 層タグ）。
   */
  system_tags?: string[];
  /**
   * AI 提案タグの初期スナップショット（正本は tag-event・AI は人間タグを上書きしない・WIK-14）。
   */
  ai_tags?: string[];
  /**
   * ユーザータグの初期スナップショット（正本は tag-event）。
   */
  user_tags?: string[];
  /**
   * PaperSectionsV1 6 節（paper 専用）。各節 {filled, text}。text は LaTeX 禁止（PPR-03）。
   */
  sections?: {
    purpose: Section;
    hypothesis: Section;
    conditions: Section;
    verification: Section;
    phase: Section;
    gap: Section;
  };
  /**
   * 節充足率（0–100・paper）。
   */
  completeness_pct?: number;
  /**
   * 条件P（機械可読・paper）。キー=条件名、値=閾値仕様。
   */
  conditions?: {
    [k: string]: Condition;
  };
  /**
   * 主張（paper）。未検証は status=hypothesis 固定、充足で evidenced（PPR-30）。
   */
  claims?: Claim[];
  /**
   * 計測行（paper）。value_origin は frozen provenance 9 値・observed_at は観測時刻（PPR-09）。
   */
  measurements?: Measurement[];
  /**
   * 投稿時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版（例: '1'）。
   */
  schema_version: string;
}
export interface Section {
  filled: boolean;
  /**
   * 節本文。Phase1 LaTeX 禁止＝\ と $ を含めない（LATEX_FORBIDDEN・PPR-03）。
   */
  text: string;
}
export interface Condition {
  min?: number;
  max?: number;
  eq?: number;
  required: boolean;
  unit?: string;
}
export interface Claim {
  claim_id: string;
  /**
   * 主張文。Phase1 LaTeX 禁止（LATEX_FORBIDDEN・PPR-03）。
   */
  statement: string;
  status: "hypothesis" | "evidenced";
  evidence_refs?: string[];
}
export interface Measurement {
  item: string;
  value: number;
  unit?: string;
  /**
   * 計測値の出所（frozen provenance value_origin 9 値・再定義しない）。
   */
  value_origin:
    | "direct_observed"
    | "image_derived"
    | "environment_derived"
    | "lineage_derived"
    | "estimated"
    | "imputed"
    | "aggregate"
    | "model_inference"
    | "unknown";
  observed_at?: string;
}
