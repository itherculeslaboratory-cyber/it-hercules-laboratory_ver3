// GENERATED FILE — do not edit by hand.
// source: schemas/frozen/thumbnail.schema.json
// title: Thumbnail Manifest (CL-07)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 本番に保存済みの blob と thumbnail 生成契約。仕様変更は既存画像 URL/表示を壊す（要件定義書 CL-07 / V3-OBS-23 / FR-18-06）。生成不変条件: リサイズ前に EXIF transpose を適用し、長辺を 512px に縮小する（libs/ihl/observation/image.py resize_long_edge・DEFAULT_LONG_EDGE=512）。EXIF transpose はフィールドではなく処理ステップのため形状には現れない。
 */
export interface Thumbnail {
  thumbnail_id: string;
  capture_id: string;
  image_id: string;
  individual_id: string;
  thumbnail_path: string;
  /**
   * 長辺 512px 制約。非スタブ画像では max(width_px, height_px) == 512。1×1 はメタデータのみ取り込み時のスタブ PNG（image.py stub_png）。両辺 512 以下は JSON Schema で強制、長辺=512 の等式は C1 の比較 TC で担保。
   */
  width_px: number;
  /**
   * 長辺 512px 制約（width_px の description 参照）。
   */
  height_px: number;
  /**
   * 画像フォーマット。要件 CL-07/FR-18-06 は『JPEG』を規定するが、ver2 実装 image.py の resize_long_edge は format='PNG' で保存しておりスタブも PNG。この矛盾（JPEG 要件 vs PNG 実装）の確定値は C1 実機照合で確定。const は付けない。
   */
  format: string;
  source_image_path?: string;
  input_hash?: string;
  thumbnail_version?: number;
  pipeline_name?: string;
  pipeline_version?: string;
  schema_version: number;
  run_id: string;
  created_at: string;
}
