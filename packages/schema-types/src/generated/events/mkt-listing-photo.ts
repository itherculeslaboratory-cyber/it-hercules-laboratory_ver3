// GENERATED FILE — do not edit by hand.
// source: schemas/events/mkt-listing-photo.schema.json
// title: Market Listing Photo data (ihl.mkt.listing_photo.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 出品写真イベント ihl.mkt.listing_photo.v1 の data 部（c8 UI磨き第2弾#2・受領10「画像がない」）。Truth キー truth/ihl.mkt.listing_photo.v1/<listing_id>-<photo_ulid>.json（listing_id 前方一致で R2 prefix list 可能・obs-photo.schema.json と同型）。バイナリは R2 media/photo/<photo_id> に put-if-absent（envelope は JSON のみ）。既存 mkt-listing 型はリネーム・破壊変更せず、写真は別イベント型として追記する（AGENTS.md 禁止事項「schemas/frozen の破壊変更」の精神を非 frozen 型にも適用）。
 */
export interface MktListingPhoto {
  /**
   * 写真の一意キー（<photo_ulid>）。
   */
  photo_id: string;
  /**
   * 所属する出品の listing_id。id 規約 <listing_id>-<photo_ulid> の前方一致キー。
   */
  listing_id: string;
  /**
   * 登録者の actor_id（出品者本人のみ・V3-AUT-17）。
   */
  actor_id: string;
  /**
   * R2 バイナリキー。'media/photo/<photo_id>' 固定（obs-photo と同一バケット配置・種別混在は photo_id の一意性で衝突しない）。
   */
  media_key: string;
  /**
   * MIME タイプ（例: image/jpeg・image/png）。
   */
  content_type: string;
  /**
   * バイナリのバイト数。
   */
  size_bytes: number;
  /**
   * バイナリの SHA-256（16 進小文字 64 桁）。
   */
  sha256: string;
}
