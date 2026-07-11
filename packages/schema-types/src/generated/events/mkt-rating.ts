// GENERATED FILE — do not edit by hand.
// source: schemas/events/mkt-rating.schema.json
// title: Market rating event (ihl.mkt.rating.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 取引評価の append-only イベント（ADR-H-08 件数モデル）。Truth キー truth/ihl.mkt.rating.v1/<rating_id>.json。projectRating が good/normal/bad 件数で集計、低評価フィルタは投影で導出（V3-MKT-27）。grade=bad は reason 必須（if/then で schema 層強制）。
 */
export interface MktRating {
  /**
   * 評価イベントの一意キー。
   */
  rating_id: string;
  /**
   * 対象取引 listing の ID。
   */
  listing_id: string;
  /**
   * 評価者の actor_id（V3-AUT-17）。auto=true の自動良評価では系統 actor。
   */
  rater_id: string;
  /**
   * 被評価者の actor_id。
   */
  ratee_id: string;
  /**
   * 評価（good / normal / bad）。
   */
  grade: "good" | "normal" | "bad";
  /**
   * 定型タグ（任意）。
   */
  tags?: string[];
  /**
   * 自由コメント（任意）。
   */
  comment?: string;
  /**
   * 低評価理由。grade=bad のとき必須（if/then）。
   */
  reason?: string;
  /**
   * 自動良評価フラグ（配送完了 +30 日無評価で cron が付与）。
   */
  auto: boolean;
  /**
   * 発生時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
