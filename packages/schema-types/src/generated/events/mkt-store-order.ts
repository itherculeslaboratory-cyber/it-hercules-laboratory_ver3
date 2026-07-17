// GENERATED FILE — do not edit by hand.
// source: schemas/events/mkt-store-order.schema.json
// title: Research support store order (ihl.mkt.store_order.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 研究支援ストア商品への注文(V3-MKT-45)。append-only。Truth キー truth/ihl.mkt.store_order.v1/<item_id>/<order_id>.json。在庫チェック必須(route が可用在庫=inventory_count−Σ既存注文quantityを都度再計算して不足なら拒否)。決済成功時に在庫を自動減算=このイベント自体の append が減算(プラチナ決済はroute側で残高チェック後にのみ append=コイン減算)。
 */
export interface MktStoreOrder {
  /**
   * 注文の一意キー(ULID)。
   */
  order_id: string;
  /**
   * 対象商品の item_id。
   */
  item_id: string;
  /**
   * 注文者の actor_id(セッション principal 強制・V3-AUT-17)。
   */
  actor_id: string;
  /**
   * 決済方式。
   */
  payment_method: "platinum" | "cod" | "external_ec";
  /**
   * 注文個数。
   */
  quantity: number;
  /**
   * payment_method=platinum のときの注文時点単価スナップショット(監査用・コイン消費計算の正本)。
   */
  unit_price_platinum?: number;
  /**
   * 注文時刻(RFC3339)。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
