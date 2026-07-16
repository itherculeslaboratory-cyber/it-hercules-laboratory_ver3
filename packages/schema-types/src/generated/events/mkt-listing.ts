// GENERATED FILE — do not edit by hand.
// source: schemas/events/mkt-listing.schema.json
// title: Market Listing data (ihl.mkt.listing.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * マーケット出品イベント ihl.mkt.listing.v1 の data 部（V3-MKT-01・出品/閲覧まで）。Truth キー truth/ihl.mkt.listing.v1/<listing_id>.json に append。一覧/詳細は投影で都度再計算（不変条項①）。取引遷移（match/transition）・決済連動は C4 対象外（後波）。
 */
export interface MktListing {
  /**
   * 出品の一意キー（<listing_ulid>）。
   */
  listing_id: string;
  /**
   * 出品者の actor_id（CL-03 導出・本人スコープ V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 出品タイトル。
   */
  title: string;
  /**
   * 出品説明（任意）。
   */
  description?: string;
  /**
   * 希望価格（円・任意）。決済連動は C4 対象外。
   */
  price?: number;
  /**
   * UGC 原文の作者言語タグ（BCP-47・actor locale 由来）。翻訳はしない＝I18-06。
   */
  lang?: string;
  /**
   * 定価出品（list_fixed）の成立方式（round-16 OQ-MKT-02）。instant=即決（既定・省略時は instant 扱い・申込確定=即成立）／consent=承諾制（オプトイン・買い手の offer/love_letter を出品者が 24h 以内に承諾して初めて成立）。
   */
  accept_mode?: "instant" | "consent";
  /**
   * V3-IND-35 割り出し予約: 対象の父個体 individual_id（♂・任意）。この listing を「予約 listing」化する（reservation_sire_id/dam_id のいずれかが有れば予約対象）。
   */
  reservation_sire_id?: string;
  /**
   * V3-IND-35 割り出し予約: 対象の母個体 individual_id（♀・任意）。
   */
  reservation_dam_id?: string;
  /**
   * V3-IND-35: 出品側が事前設定する応募単位の最小匹数（この匹数未満の予約は自動マッチング対象外・任意）。
   */
  reservation_min_apply_count?: number;
  /**
   * V3-IND-35: 出品側が事前設定する応募単位の最大匹数（この匹数超の予約は自動マッチング対象外・任意）。
   */
  reservation_max_apply_count?: number;
  /**
   * 出品時刻。
   */
  created_at?: string;
  /**
   * data スキーマ版。
   */
  schema_version?: number;
}
