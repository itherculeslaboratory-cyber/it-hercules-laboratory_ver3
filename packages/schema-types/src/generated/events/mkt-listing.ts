// GENERATED FILE — do not edit by hand.
// source: schemas/events/mkt-listing.schema.json
// title: Market Listing data (ihl.mkt.listing.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * マーケット出品イベント ihl.mkt.listing.v1 の data 部（V3-MKT-01・出品/閲覧まで）。Truth キー truth/ihl.mkt.listing.v1/<listing_id>.json に append。一覧/詳細は投影で都度再計算（不変条項①）。取引遷移（match/transition）・決済連動は C4 対象外（後波）。
 */
export interface MktListing {
  /**
   * 出品の一意キー（<listing_ulid>）。
   */
  listing_id: string;
  /**
   * 出品者の actor_id（CL-03 導出・本人スコープ V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 出品タイトル。
   */
  title: string;
  /**
   * 出品説明（任意）。
   */
  description?: string;
  /**
   * 希望価格（円・任意）。決済連動は C4 対象外。
   */
  price?: number;
  /**
   * 出品時刻。
   */
  created_at?: string;
  /**
   * data スキーマ版。
   */
  schema_version?: number;
}
