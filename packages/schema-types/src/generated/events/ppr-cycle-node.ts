// GENERATED FILE — do not edit by hand.
// source: schemas/events/ppr-cycle-node.schema.json
// title: PPR cycle node (ihl.ppr.cycle_node.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * content(paper)以外の新しい「ノード型」(review/hypothesis/replication_proposal/replication_result/research_gap/comment/correction_note/knowledge_evidence)を content.schema.json を1文字も変えずに追加するための append-only イベント（V3-PPR-24/25/03・BBS-02/18/25・OBS-51の受け皿。design35 §A-5で設計確定）。Truth キー truth/ihl.ppr.cycle_node.v1/<node_id>.json。GET /node/:node_id ディスパッチャが id 接頭辞で content/plaza-post/ppr-cycle-node のいずれかへ振り分ける（新しい保存場所は作らない）。
 */
export interface PprCycleNode {
  /**
   * このノードの一意キー（ULID）。GET /node/:node_id で参照される。
   */
  node_id: string;
  /**
   * ノード種別（8値。paper は既存 content 側にあるためここには入れない＝二重定義を作らない）。knowledge_evidence が PPR-24 の Evidence型 Knowledge を担う。
   */
  node_type:
    | "review"
    | "hypothesis"
    | "replication_proposal"
    | "replication_result"
    | "research_gap"
    | "comment"
    | "correction_note"
    | "knowledge_evidence";
  subject_ref?: CitationReferenceCiteRefSharedType;
  /**
   * PPR-24 の Evidence型7区画（全て optional・knowledge_evidence 以外の node_type では省略してよい）。
   */
  sections?: {
    /**
     * 概要（任意）。
     */
    summary?: string;
    /**
     * 現在の理解（任意）。
     */
    current_understanding?: string;
    /**
     * 主な説（任意）。★配列必須 — 「複数の説を共存させ」「勝敗を決めず」が要件のため、1つに絞る単数フィールド・勝者フラグは作らない（design35 §A-5）。
     */
    leading_hypotheses?: string[];
    /**
     * 根拠（任意）。
     */
    evidence?: string;
    /**
     * 反論（任意）。
     */
    counterarguments?: string;
    /**
     * 未解決（任意）。
     */
    unresolved?: string;
    /**
     * 履歴（任意）。
     */
    history?: string;
  };
  /**
   * このノードを起こした actor_id（セッション principal 強制・V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 作成時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
/**
 * 構造化引用の共用型（CiteRef）。plaza-post の cite_refs[]・gov-dispute の subject_ref から相対 $ref で参照する単一正本（スキーマ複製禁止・V3-BBS-20）。envelope の data ではなく component schema なので created_at/schema_version は持たない。[ihl:cite type=X id=Y] トークンは従属で、cite_refs[] が正本。
 */
export interface CitationReferenceCiteRefSharedType {
  /**
   * 引用先の種別（安定 URL 生成 citeUrl の分岐キー）。
   */
  type:
    | "observation"
    | "individual"
    | "paper"
    | "thread"
    | "post"
    | "user"
    | "tag"
    | "listing"
    | "precedent"
    | "fork"
    | "url"
    | "book"
    | "listing_engagement"
    | "trade_private"
    | "trade_public_exchange"
    | "market_rating";
  /**
   * 引用先の一意キー（type ごとの ID 空間）。
   */
  id: string;
  /**
   * 表示ラベル（任意・UGC 原文まま・翻訳しない）。
   */
  label?: string;
  /**
   * post 種別引用のアンカー post_id（任意・permalink フラグメント用）。
   */
  post_id?: string;
}
