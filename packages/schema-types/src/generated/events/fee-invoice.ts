// GENERATED FILE — do not edit by hand.
// source: schemas/events/fee-invoice.schema.json
// title: IHL fee invoice event (ihl.fee.invoice.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * L-PAY: 5%システム維持費のゆるい請求イベント（round-16裁定・取引成立→計算して振り込んでね方式・取り逃し許容・docs/planning/rulings/round-16-answers-raw.md 受領1〜7）。既存義務台帳（ihl.gmo.obligation.v1・gmo-obligation.schema.json）の obligation_id をそのまま参照する。Truth キー truth/ihl.fee.invoice.v1/<invoice_id>.json。決済手段=PAY.JP（第一弾）。GMO の U-code 正規表現照合は使わず、PAY.JP charge の metadata.obligation_id にこの obligation_id をそのまま載せ、merchant側IDで直接照合する（fee-routes.ts の POST /fees/payjp-webhook）。
 */
export interface FeeInvoice {
  /**
   * 請求イベントの一意キー。
   */
  invoice_id: string;
  /**
   * 参照する義務台帳（ihl.gmo.obligation.v1）の obligation_id。PAY.JP charge の metadata.obligation_id にも同値を載せ、直接照合する（U-code不使用）。
   */
  obligation_id: string;
  /**
   * 義務者本人の actor_id（V3-AUT-17・本人スコープ強制）。
   */
  actor_id: string;
  /**
   * 請求額（円・整数 > 0・発行時点の義務台帳 amount を転記）。
   */
  amount: number;
  /**
   * 発行時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
