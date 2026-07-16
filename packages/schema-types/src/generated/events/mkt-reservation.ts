// GENERATED FILE — do not edit by hand.
// source: schemas/events/mkt-reservation.schema.json
// title: Market reservation data (ihl.mkt.reservation.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 割り出し予約(V3-IND-35)。割り出し(クラッチ確定)前に、親個体(♂/♀)を指定した予約 listing(mkt-listing.v1 の reservation_sire_id/reservation_dam_id)に対し、買い手が単価・匹数を宣言する append-only の一意record。イミュータブル(状態遷移は ihl.mkt.reservation_event.v1 が別途担う)。Truth キー truth/ihl.mkt.reservation.v1/<reservation_id>.json。
 */
export interface MktReservation {
  /**
   * 予約の一意キー(ULID)。
   */
  reservation_id: string;
  /**
   * 対象の予約 listing_id(mkt-listing.v1・reservation_sire_id/dam_id を持つ)。
   */
  listing_id: string;
  /**
   * 予約した買い手の actor_id(セッション principal 強制・V3-AUT-17)。
   */
  actor_id: string;
  /**
   * 希望単価(円)。自動マッチングは単価の高い順(V3-IND-35)。
   */
  desired_unit_price: number;
  /**
   * 希望匹数。出品側しきい値(mkt-listing.v1 reservation_min/max_apply_count)の範囲外は自動マッチング対象外。
   */
  desired_count: number;
  /**
   * 任意メモ。
   */
  note?: string;
  /**
   * 予約時刻(RFC3339)。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
