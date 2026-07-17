// GENERATED FILE — do not edit by hand.
// source: schemas/events/mkt-store-item.schema.json
// title: Research support store item (ihl.mkt.store_item.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 研究成果(project_id)に紐づく研究支援ストアの商品(V3-MKT-45)。append-only。Truth キー truth/ihl.mkt.store_item.v1/<item_id>.json。決済はプラチナコイン/代引き(現金)/外部EC誘導の3方式(payment_methods)から出品者が選んで許可する。在庫は inventory_count(初期値)からの都度再計算(Σ確定注文の quantity を減算)で、UPDATE はしない(不変条項③)。
 */
export interface MktStoreItem {
  /**
   * 商品の一意キー(ULID)。
   */
  item_id: string;
  /**
   * 紐づく研究成果の project_id(ihl.research.project.v1)。
   */
  project_id: string;
  /**
   * 出品者の actor_id(セッション principal 強制・V3-AUT-17)。
   */
  actor_id: string;
  /**
   * 商品名。
   */
  title: string;
  /**
   * 初期在庫数(以後の可用在庫は確定注文の都度再計算・不変条項①③)。
   */
  inventory_count: number;
  /**
   * プラチナコイン決済時の単価(payment_methods に platinum を含む場合)。
   */
  price_platinum?: number;
  /**
   * 外部EC(BASE/Shopify等)誘導URL(payment_methods に external_ec を含む場合)。
   */
  external_ec_url?: string;
  /**
   * 許可する決済方式(プラチナコイン/代引き/外部EC誘導のいずれか複数可)。
   *
   * @minItems 1
   */
  payment_methods: ["platinum" | "cod" | "external_ec", ...("platinum" | "cod" | "external_ec")[]];
  /**
   * 出品時刻(RFC3339)。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
