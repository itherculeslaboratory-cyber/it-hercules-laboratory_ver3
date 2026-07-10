// GENERATED FILE — do not edit by hand.
// source: schemas/events/obs-photo.schema.json
// title: Observation Photo data (ihl.obs.photo.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 観測写真イベント ihl.obs.photo.v1 の data 部。Truth キー truth/ihl.obs.photo.v1/<capture_id>-<photo_ulid>.json（capture_id 前方一致で R2 prefix list 可能）。バイナリは R2 media/photo/<photo_id> に put-if-absent（envelope は JSON のみ）。
 */
export interface ObsPhoto {
  /**
   * 写真の一意キー（<photo_ulid>）。
   */
  photo_id: string;
  /**
   * 所属する観測セッションの capture_id。id 規約 <capture_id>-<photo_ulid> の前方一致キー。
   */
  capture_id: string;
  /**
   * 登録者の actor_id（本人スコープ V3-AUT-17）。
   */
  actor_id: string;
  /**
   * R2 バイナリキー。'media/photo/<photo_id>' 固定。
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
