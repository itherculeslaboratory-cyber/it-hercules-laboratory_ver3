// GENERATED FILE — do not edit by hand.
// source: schemas/frozen/qr-token.schema.json
// title: QR Token (CL-10)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 発行済み QR（アプリスキーム deep link）が現物ラベルとして流通。トークン形式変更で既存 QR が失効（要件定義書 CL-10 / V3-OBS-20 / FR-ENV-05・FR-MVP-05）。本スキーマは ver2 で実装済みの env_qr_token_v1（placement_store.create_qr_token・FR-ENV-05 の設置場所 QR）の形状。CL-10 が併せて指す個体 QR（FR-MVP-05・観測再開）の実体レコードは ver2 に別スキーマとして存在せず、その形状と deep link は C1 実機照合で確定。
 */
export interface QrToken {
  schema: "env_qr_token_v1";
  /**
   * secrets.token_urlsafe(24) 由来の URL-safe base64（約 32 文字）。resolve_qr_token は 200 文字超を拒否。deep link は 'ihl://env/qr/<token>'。
   */
  token: string;
  /**
   * 紐づく設置場所 ID（placement）。個体 QR（FR-MVP-05）採用時は対象キーが individual_id になり得る — C1 で確定。
   */
  placement_id: string;
  actor_id: string;
  created_at: string;
  /**
   * TTL（既定 3600 秒）。resolve は expires_at を過ぎたトークンを None として失効させる。
   */
  expires_at: string;
}
