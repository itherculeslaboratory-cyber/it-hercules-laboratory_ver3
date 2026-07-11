// GENERATED FILE — do not edit by hand.
// source: schemas/events/mkt-post-office.schema.json
// title: Post office selection event (ihl.mkt.post_office.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 配送見積り用の最寄り郵便局登録イベント（append-only）。Truth キー truth/ihl.mkt.post_office.v1/<post_office_event_id>.json。estimateShipping が局間距離×梱包サイズで送料を投影。住所は保持しない（PII 不使用・不変条項③・V3-MKT-20）。
 */
export interface MktPostOffice {
  /**
   * 登録イベントの一意キー。
   */
  post_office_event_id: string;
  /**
   * 登録者の actor_id（V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 郵便局の識別子（住所ではない・距離算出用）。
   */
  post_office_id: string;
  /**
   * 既定局フラグ（最新の true 行を採用）。
   */
  is_default: boolean;
  /**
   * 発生時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
