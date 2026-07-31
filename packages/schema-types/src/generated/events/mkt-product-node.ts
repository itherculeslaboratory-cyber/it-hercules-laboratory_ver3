// GENERATED FILE — do not edit by hand.
// source: schemas/events/mkt-product-node.schema.json
// title: Market ProductNode event (ihl.mkt.product_node.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 飼育用品を科学的に評価する ProductNode の append-only イベント（V3-MKT-44）。Truth キー truth/ihl.mkt.product_node.v1/<product_id>.json。出品(mkt-listing)は取引が終われば寿命が尽きるが、商品としての評価は残り続けるため、mkt-listing に相乗りさせず独立イベント型とする（design19 T1-7 案A）。成功率/失敗率/価格履歴は保存せず、obs-capture(product_ref)とind-life-eventを材料に投影(その場計算)で導出する。affiliate_url はアフィリエイトを付けたいユーザーの自分URL(self)。付けないユーザーは運営URL(operator・既定)だが、実URLは本スキーマ導入時点では未配線（人間ゲート）。paper_refs は cite-ref.schema.json への相対 $ref で関連論文を参照する（新しい参照型を発明しない）。
 */
export interface MktProductNode {
  /**
   * 商品の一意キー（ULID）。
   */
  product_id: string;
  /**
   * 商品名。
   */
  name: string;
  /**
   * 商品カテゴリ（自由記述）。
   */
  category: string;
  /**
   * operator=運営URL(報酬はプラチナコインと貢献度) / self=出品者自身のアフィリエイトURL。既定は operator。
   */
  affiliate_mode: "operator" | "self";
  /**
   * アフィリエイトURL（任意・affiliate_mode=self のとき使用。未設定のまま出荷可＝空の時はリンクを出さない）。
   */
  affiliate_url?: string;
  /**
   * 関連論文への参照（cite-ref 共用型・任意）。
   */
  paper_refs?: CitationReferenceCiteRefSharedType[];
  /**
   * 発生時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版（任意）。
   */
  schema_version?: string;
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
