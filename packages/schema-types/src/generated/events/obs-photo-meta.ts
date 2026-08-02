// GENERATED FILE — do not edit by hand.
// source: schemas/events/obs-photo-meta.schema.json
// title: Observation Photo QC Meta data (ihl.obs.photo_meta.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 写真QCメタイベント ihl.obs.photo_meta.v1 の data 部（OBS-58 QCフィルタ + OBS-12 view/file_kind/booth観測メタ）。g93裁定(00-hq\kits\lane-think\R0802-37b8e4-REPORT-2026-08-02-g93-truththink.md §2-5/T3)による是正 — 実データ5/5件から必須5フィールドを確定。view/file_kind/booth_id/booth_typeはクライアント由来の任意観測メタで、実データには出現しないがコードは出力しうるため optional で含める(observation-routes.ts:616-619)。
 */
export interface ObsPhotoMeta {
  /**
   * 写真の一意キー。
   */
  photo_id: string;
  /**
   * 所属する capture の capture_id。
   */
  capture_id: string;
  /**
   * QC判定フラグ。観測値が 'reject' 1種のみで値域を確定できないため enum で絞らない(g93裁定§2-5)。
   */
  qc_flag: string;
  /**
   * QCスコア。実データは整数値だが integer に絞る根拠が無い(g93裁定§2-5)。
   */
  qc_score: number;
  /**
   * QC判定理由の配列。
   */
  qc_reasons: string[];
  /**
   * クライアント指定のcapture view(optional・observation-routes.ts:616)。
   */
  view?: string;
  /**
   * クライアント指定のファイル種別(optional・observation-routes.ts:617)。
   */
  file_kind?: string;
  /**
   * クライアント指定のbooth識別子(optional・observation-routes.ts:618)。
   */
  booth_id?: string;
  /**
   * クライアント指定のbooth種別(optional・observation-routes.ts:619)。
   */
  booth_type?: string;
}
