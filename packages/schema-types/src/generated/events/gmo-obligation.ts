// GENERATED FILE — do not edit by hand.
// source: schemas/events/gmo-obligation.schema.json
// title: GMO payment obligation event (ihl.gmo.obligation.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * GMO 振込義務台帳の append-only イベント（8% 税 / PT チャージ / P2P を 1 安定コードで共用）。Truth キー truth/ihl.gmo.obligation.v1/<obligation_id>.json。reconcileOnce が due_date 昇順で FIFO 消込（義務発生日以降の最古未払いへ・V3-MKT-12）。
 */
export interface GmoObligation {
  /**
   * 義務イベントの一意キー。
   */
  obligation_id: string;
  /**
   * 義務者の actor_id（V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 安定振込コード（deriveTransferCode 由来・8%税/PT/P2P で共用）。
   */
  transfer_code: string;
  /**
   * 義務金額（円・整数 > 0）。
   */
  amount: number;
  /**
   * 義務種別（維持費税 / PT チャージ / P2P）。
   */
  obligation_kind: "fee_tax" | "pt_topup" | "p2p";
  /**
   * 義務発生日（RFC3339・FIFO 消込の起算・昇順整列キー）。
   */
  due_date: string;
  /**
   * 発生時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
