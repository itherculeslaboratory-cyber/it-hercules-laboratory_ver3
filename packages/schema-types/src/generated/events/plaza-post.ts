// GENERATED FILE — do not edit by hand.
// source: schemas/events/plaza-post.schema.json
// title: Plaza post data (ihl.plaza.post.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 知の広場の投稿イベント ihl.plaza.post.v1 の data 部。Truth キー truth/ihl.plaza.post.v1/<channel>/<thread_id>/<post_id>.json に append-only（BBS-05）。スレ表示・permalink・tombstone は projectThread が都度再計算（常駐 DB 禁止）。correction_of は原投稿を上書きせず追記で共存。cite_refs は CiteRef 単一正本を相対 $ref で参照（BBS-20）。
 */
export interface PlazaPost {
  /**
   * 投稿の一意キー（ULID・permalink 不変）。
   */
  post_id: string;
  /**
   * 投稿者の actor_id（セッション principal で強制刻印・V3-AUT-17）。
   */
  actor_id: string;
  /**
   * チャネル（=screen_id/feature キー・板は channel に紐付く・BBS-03）。
   */
  channel: string;
  /**
   * 必須トピック（Zulip 型 channel+topic・BBS-36）。
   */
  topic: string;
  /**
   * 板の別（説明/愚痴/改善・BBS-03 + Engagement=公開Q&A/称賛/未出品オファー一括募集・BBS-28）。
   */
  board_kind: "guide" | "complaint" | "improvement" | "engagement";
  /**
   * スレッドキー（root 投稿は post_id 自身）。
   */
  thread_id: string;
  /**
   * 本文（UGC 原文まま・翻訳しない・空文字は許容しない場合 minLength は route 側で検証）。
   */
  body: string;
  /**
   * 返信元 post_id（>> アンカー・任意）。
   */
  reply_to?: string;
  /**
   * 追記訂正の対象 post_id（原投稿は上書きせず共存・任意）。
   */
  correction_of?: string;
  /**
   * 構造化引用の正本（CiteRef[]・BBS-20・[ihl:cite] トークンは従属）。
   */
  cite_refs?: CitationReferenceCiteRefSharedType[];
  /**
   * @ 通知先 actor_id 群（通知チャネル・任意）。
   */
  mentions?: string[];
  /**
   * # 検索タグ群（検索チャネル・任意）。
   */
  tags?: string[];
  /**
   * 投稿時刻（RFC3339）。
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
  type: "observation" | "individual" | "paper" | "thread" | "post" | "user" | "tag" | "listing" | "precedent" | "fork";
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
