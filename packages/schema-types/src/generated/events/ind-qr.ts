// GENERATED FILE — do not edit by hand.
// source: schemas/events/ind-qr.schema.json
// title: Individual QR data (ihl.ind.qr.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 個体 QR 発行イベント ihl.ind.qr.v1 の data 部。Truth キー truth/ihl.ind.qr.v1/<token>.json。token は frozen qr-token（CL-10）と同形式（URL-safe base64・20〜200 字）でトークン形式は無変更。現物ラベル用途のため expires_at は任意（env QR の frozen スキーマは変更しない）。
 */
export interface IndQr {
  /**
   * URL-safe base64 トークン（frozen qr-token と同形式・CL-10 無変更）。deep link の起点。
   */
  token: string;
  /**
   * 紐づく個体 ID（観測再開の対象）。
   */
  individual_id: string;
  /**
   * 発行者の actor_id。
   */
  actor_id: string;
  /**
   * 発行時刻（RFC3339）。
   */
  created_at: string;
  /**
   * 失効時刻（任意）。現物ラベル用途では無期限（未設定）を許容。
   */
  expires_at?: string;
}
