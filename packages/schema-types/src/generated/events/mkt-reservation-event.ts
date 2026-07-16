// GENERATED FILE — do not edit by hand.
// source: schemas/events/mkt-reservation-event.schema.json
// title: Market reservation state event (ihl.mkt.reservation_event.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 割り出し予約(V3-IND-35)の append-only 状態機械イベント。割り出し完了(harvested_count)後の自動マッチングが単価降順で match_offer を発行し、買い手の confirm(成立)/decline(未確定・カルマ-1)、または応答期限超過の expire(未確定・カルマ-1)を記録する。Truth キー truth/ihl.mkt.reservation_event.v1/<reservation_id>-<event_id>.json。current 状態は listing 単位の全 event を都度畳んで投影する(常駐カウンタなし・不変条項①)。
 */
export interface MktReservationEvent {
  /**
   * イベントの一意キー(ULID)。
   */
  event_id: string;
  /**
   * 対象の ihl.mkt.reservation.v1 reservation_id。
   */
  reservation_id: string;
  /**
   * 対象の予約 listing_id(prefix scan の集約キー)。
   */
  listing_id: string;
  /**
   * match_offer=自動マッチングが提示(系統 actor)／confirm=買い手が確認・成立／decline=買い手が明示辞退(未確定)／expire=応答期限超過(未確定・read-time 判定+自己修復 append)。decline/expire はいずれも V3-IND-35 のカルマ-1 対象。
   */
  kind: "match_offer" | "confirm" | "decline" | "expire";
  /**
   * 発行者の actor_id。match_offer/expire は系統 actor(V3-AUT-17 例外・agent 生成)、confirm/decline は買い手本人。
   */
  actor_id: string;
  /**
   * match_offer 時に提示された匹数。
   */
  offered_count?: number;
  /**
   * match_offer 時に提示された単価(円)。
   */
  offered_unit_price?: number;
  /**
   * match_offer 時の単価降順順位(0 始まり)。
   */
  rank?: number;
  /**
   * match_offer の確認期限(RESERVATION_CONFIRM_WINDOW_HOURS)。
   */
  expires_at?: string;
  /**
   * 記録時刻(RFC3339)。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
