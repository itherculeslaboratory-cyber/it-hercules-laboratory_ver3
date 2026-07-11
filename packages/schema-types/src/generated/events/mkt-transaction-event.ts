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
   * 取引アクション種別（許可辺 MARKET_EDGES 外の遷移は route が 409）。
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
    | "fee_unpaid";
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
