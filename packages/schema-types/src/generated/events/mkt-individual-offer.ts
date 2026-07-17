// GENERATED FILE — do not edit by hand.
// source: schemas/events/mkt-individual-offer.schema.json
// title: Direct offer on a not-yet-listed individual (ihl.mkt.individual_offer.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 未出品個体への直接オファー(欲しい意思表示・V3-MKT-06)。個体詳細画面から送信する。出品(mkt-listing)を介さず個体(individual_id)に直接ぶら下がる append-only イベント。Truth キー truth/ihl.mkt.individual_offer.v1/<individual_id>/<offer_id>.json。kind=love_letter は値段非開示(応答/一覧で amount を返さない・POST /market/offers の love_letter と同じ規約)。
 */
export interface MktIndividualOffer {
  /**
   * オファーの一意キー(ULID)。
   */
  offer_id: string;
  /**
   * 対象個体の individual_id。
   */
  individual_id: string;
  /**
   * オファー送信者の actor_id(セッション principal 強制・V3-AUT-17)。
   */
  actor_id: string;
  /**
   * オファー時点の現観測者(個体マスタ actor_id)のスナップショット。所有者の一覧投影の絞り込みに使う。
   */
  owner_id: string;
  /**
   * offer=金額提示 / love_letter=告白方式(値段開示なし一発勝負・血統/実験目的等の理由文で選ばれる)。
   */
  kind: "offer" | "love_letter";
  /**
   * 提示額(円・kind=offer のみ想定・love_letter は非開示につき応答に出さない)。
   */
  amount?: number;
  /**
   * V3-MKT-06 の 'research_only' ポリシー判定に使う自己申告目的(既定 personal)。
   */
  purpose?: "personal" | "research";
  /**
   * 血統の素晴らしさ・実験目的等を伝える自由文(love_letter で主に使う)。
   */
  message?: string;
  /**
   * 送信時刻(RFC3339)。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
