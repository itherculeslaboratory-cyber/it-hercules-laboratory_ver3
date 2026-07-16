// GENERATED FILE — do not edit by hand.
// source: schemas/events/ind-clutch-event.schema.json
// title: Individual Clutch Event data (ihl.ind.clutch_event.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * クラッチ append-only イベント ihl.ind.clutch_event.v1 の data 部（匹数照合・減耗照合・昇格）。Truth キー truth/ihl.ind.clutch_event.v1/<clutch_id>-<event_id>.json。current_count は clutch.initial_count → 最新 recount を基点に、以降の attrition/promote の death_count を差し引いて都度再計算する（常駐カウンタなし・不変条項①）。recount の expected_before/discrepancy は count層とindividual層のattrition照合で水増し・行方不明を検出する（V3-IND-36）。
 */
export interface IndClutchEvent {
  /**
   * イベントの一意キー（ULID）。
   */
  event_id: string;
  /**
   * 対象クラッチの clutch_id。
   */
  clutch_id: string;
  /**
   * イベント種別。recount=絶対数の再計測（基点リセット）／attrition=減耗照合（死亡差引）／promote=個別容器へ分割（個体化・count層からindividual層へ）。
   */
  kind: "recount" | "attrition" | "promote";
  /**
   * イベント発生時刻（RFC3339）。
   */
  at: string;
  /**
   * recount 時の絶対数（この値が以後の新しい基点になる）。
   */
  counted?: number;
  /**
   * attrition/promote 時の死亡照合数（current_count から差し引く）。
   */
  death_count?: number;
  /**
   * recount 時、この recount 適用前の投影 current_count（直前の基点+以降の attrition/promote 差引済み・監査用）。kind=recount のみ設定。
   */
  expected_before?: number;
  /**
   * recount 時の counted − expected_before（V3-IND-36 attrition 照合の検出値）。正=水増し疑い（想定より多い）／負=行方不明疑い（想定より少ない・未記録の減耗）。kind=recount のみ設定。
   */
  discrepancy?: number;
  /**
   * promote 時に生成された individual_id の一覧。
   */
  promoted_individual_ids?: string[];
  /**
   * 任意の注記。
   */
  note?: string;
  /**
   * 記録者の actor_id（V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 記録時刻（RFC3339）。
   */
  created_at: string;
}
