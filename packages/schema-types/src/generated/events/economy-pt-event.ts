// GENERATED FILE — do not edit by hand.
// source: schemas/events/economy-pt-event.schema.json
// title: Platinum PT ledger event (ihl.economy.pt_event.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * プラチナ PT の append-only 増減イベント。Truth キー truth/ihl.economy.pt_event.v1/<pt_event_id>.json。projectPt が delta 合計で残高を都度再計算（非公開＝本人のみ・V3-KRM-10）。delta は整数（+mint / -spend）。
 */
export interface EconomyPtEvent {
  /**
   * PT イベントの一意キー。
   */
  pt_event_id: string;
  /**
   * 残高主体の actor_id（セッション principal 強制・V3-AUT-17）。
   */
  actor_id: string;
  /**
   * PT 増減（+mint / -spend）。合計が残高。
   */
  delta: number;
  /**
   * 増減理由（mint=鋳造 / indulgence_spend=免罪符購入 / vote_spend=投票消費 / manual=手動）。
   */
  reason_code: "mint" | "indulgence_spend" | "vote_spend" | "manual";
  /**
   * 関連イベント／対象の参照（任意）。
   */
  ref?: string;
  /**
   * 発生時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版（例: '1'）。
   */
  schema_version: string;
}
