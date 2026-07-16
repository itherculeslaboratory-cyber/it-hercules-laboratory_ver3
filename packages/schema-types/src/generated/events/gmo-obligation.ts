// GENERATED FILE — do not edit by hand.
// source: schemas/events/gmo-obligation.schema.json
// title: GMO payment obligation event (ihl.gmo.obligation.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 義務台帳の append-only イベント（5% 税 / P2P を 1 安定コードで共用）。Truth キー truth/ihl.gmo.obligation.v1/<obligation_id>.json。GMO route 自体は retired（round-16・gmo-routes.ts 冒頭コメント参照）だが本イベント型は fee-routes.ts（PAY.JP 決済）が継承し読み書きする（型リネーム禁止・新イベント型は append の原則）。reconcileOnce（GMO 照合・非マウント）は due_date 昇順で FIFO 消込（義務発生日以降の最古未払いへ・V3-MKT-12）。pt_topup（現金→PT チャージ）は round-16 裁定で廃止（V3-MKT-38「プラチナは金銭購入不可」が正）— enum から削除済み。
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
   * 安定振込コード（deriveTransferCode 由来・5%税/PT/P2P で共用）。
   */
  transfer_code: string;
  /**
   * 義務金額（円・整数 > 0）。
   */
  amount: number;
  /**
   * 義務種別（維持費税 / P2P）。pt_topup（PT チャージ）は round-16 裁定で廃止済み（V3-MKT-38）。
   */
  obligation_kind: "fee_tax" | "p2p";
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
