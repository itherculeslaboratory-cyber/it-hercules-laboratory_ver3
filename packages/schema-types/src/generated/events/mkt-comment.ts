// GENERATED FILE — do not edit by hand.
// source: schemas/events/mkt-comment.schema.json
// title: Market listing public comment (ihl.mkt.comment.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 出品(listing)の公開コメント append-only イベント(V3-MKT-03)。マッチング前の公開画面は「商品詳細+公開Q&A+ほめボードのみ」— この2種を1つの型で持つ。Truth キー truth/ihl.mkt.comment.v1/<listing_id>/<comment_id>.json。kind=question/praise は誰でも投稿可、kind=answer は出品者のみ(route ガード)で parent_comment_id(質問)必須。全件マッチング前後を問わず公開(非削除)。
 */
export interface MktComment {
  /**
   * コメントの一意キー(ULID)。
   */
  comment_id: string;
  /**
   * 対象出品の listing_id。
   */
  listing_id: string;
  /**
   * 投稿者の actor_id(セッション principal 強制・V3-AUT-17)。
   */
  actor_id: string;
  /**
   * 公開Q&Aの質問/回答、またはほめボードのほめコメント。
   */
  kind: "question" | "answer" | "praise";
  /**
   * 本文。
   */
  body: string;
  /**
   * kind=answer のとき対象質問の comment_id(必須・route + schema 二重強制)。
   */
  parent_comment_id?: string;
  /**
   * 投稿時刻(RFC3339)。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
