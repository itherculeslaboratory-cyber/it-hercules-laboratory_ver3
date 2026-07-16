// GENERATED FILE — do not edit by hand.
// source: schemas/events/fee-settlement.schema.json
// title: IHL fee settlement event (ihl.fee.settlement.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * L-PAY: PAY.JP charge 確認済みの消込イベント（round-16裁定）。Truth キー truth/ihl.fee.settlement.v1/<charge_id 安全化>.json（charge_id を put-if-absent キーに使う=冪等・webhook 再送で二重消込しない）。POST /fees/payjp-webhook は charge id を GET /v1/charges/:id で必ず再照会し（PAY.JP の webhook は署名検証の仕組みが薄いため本文を信用しない・payjp-connector.ts 冒頭コメント参照）、確認できた paid=true の charge だけをここに記録する。
 */
export interface FeeSettlement {
  /**
   * 消込イベントの一意キー。
   */
  settlement_id: string;
  /**
   * 消込対象の義務台帳（ihl.gmo.obligation.v1）obligation_id（PAY.JP charge の metadata.obligation_id と直接一致で照合済み）。
   */
  obligation_id: string;
  /**
   * 義務者本人の actor_id（義務台帳から転記・V3-AUT-17）。
   */
  actor_id: string;
  /**
   * PAY.JP charge id（GET /v1/charges/:id で再照会し paid=true を確認済み）。
   */
  charge_id: string;
  /**
   * PAY.JP 側で確認された決済額（円）。ゆるい請求のため義務額との厳密一致は求めない。
   */
  amount: number;
  /**
   * 消込成立時刻（RFC3339）。
   */
  matched_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
