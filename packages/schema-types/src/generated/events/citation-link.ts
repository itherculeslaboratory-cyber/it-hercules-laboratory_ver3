// GENERATED FILE — do not edit by hand.
// source: schemas/events/citation-link.schema.json
// title: Citation link (ihl.citation.link.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 論文(content)↔板(plaza thread/post)↔観測↔論文…のあらゆる方向の構造化リンクを、content.schema.json 自体は一切変更せず別イベントストリームとして記録する append-only 行（V3-PPR-08・bridgeplan J1-3で設計確定）。Truth キー truth/ihl.citation.link.v1/<content_id>/<link_id>.json。既存の CiteRef（cite-ref.schema.json）をそのまま target_ref に流用するため、リンク先の種別（post/thread/observation/individual/paper 等）は新規enumを増やさず既存12+4値をそのまま使い回す。査読コメント（BBSレビュー層）は本スキーマの対象外＝新規スキーマ0本のまま既存 plaza-post をそのまま使う（bridgeplan J1-3）。
 */
export interface CitationLink {
  /**
   * このリンク行の一意キー（ULID）。
   */
  link_id: string;
  /**
   * 起点となる論文（Living Paper）の content_id（schemas/events/content.schema.json 側の正本を参照するのみ・当該ファイルは書き換えない）。
   */
  content_id: string;
  target_ref: CitationReferenceCiteRefSharedType;
  /**
   * リンクの意味種別（任意・省略時は単純な相互参照として扱う）。
   */
  link_kind?: "cites" | "discussed_in" | "derived_from" | "responds_to";
  /**
   * このリンクを記録した actor_id（セッション principal 強制・V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 記録時刻（RFC3339）。
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
