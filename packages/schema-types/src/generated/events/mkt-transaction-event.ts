// GENERATED FILE — do not edit by hand.
// source: schemas/events/mkt-transaction-event.schema.json
// title: Market transaction event (ihl.mkt.transaction_event.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * マーケット取引の append-only 状態機械イベント。Truth キー truth/ihl.mkt.transaction_event.v1/<transaction_event_id>.json。reduceMarket が listing 単位で kind 列を畳んで末尾状態を投影（非エスクロー＝資金非預り・V3-MKT-01/02）。
 */
export interface MktTransactionEvent {
  /**
   * 取引イベントの一意キー。
   */
  transaction_event_id: string;
  /**
   * 対象 listing の ID（状態機械の集約キー）。
   */
  listing_id: string;
  /**
   * イベント発行者の actor_id（V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 取引アクション種別（許可辺 MARKET_EDGES 外の遷移は route が 409）。pay_declare/pay_confirm は round-16 決済裁定（銀行振込既定・IHL非関与）の状態遷移で、tax_* 同様 listing state を動かさない経済副次イベント（買主:振込済み申告→売主:入金確認、を都度投影で表示する）。pay_confirm の payload.mismatch(任意 partial|over)は round-15裁定 V3-MKT-13「金額相違」自己申告(部分入金=残債・過入金=クレジット記録のみ・自動制裁なし)。cancel は matched→cancelled の許可辺（猶予キャンセル/48h no-pay 自動キャンセル）。ship_link は round-15裁定 V3-MKT-20(匿名配送=外部URL中継)で売り手が入金確認後に payload.external_shipping_url を relay する経済副次イベント(住所非保持・システムは中継のみ)。
   */
  kind:
    | "list_fixed"
    | "list_auction"
    | "list_lottery"
    | "list_platinum"
    | "offer"
    | "love_letter"
    | "bid"
    | "match"
    | "ship"
    | "receive"
    | "rate"
    | "settle"
    | "delist"
    | "transfer"
    | "tax_debt"
    | "tax_pay"
    | "fee_unpaid"
    | "pay_declare"
    | "pay_confirm"
    | "cancel"
    | "ship_link";
  /**
   * 相手方 actor_id（offer/match/transfer 等・任意）。
   */
  counterparty?: string;
  /**
   * 金額（円・fixed 価格 / bid / 税額等・任意）。
   */
  amount?: number;
  /**
   * 取引対象の個体 ID 列（所有権系譜の対象・任意）。
   */
  individual_ids?: string[];
  /**
   * アクション固有の追加データ（任意）。
   */
  payload?: {};
  /**
   * 発生時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
