// GENERATED FILE — do not edit by hand.
// source: schemas/events/obs-schedule.schema.json
// title: Observation Schedule data (ihl.obs.schedule.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 観測スケジュール append-only イベントの data 部。Truth キー truth/ihl.obs.schedule.v1/<individual_id>-<ulid>.json。computeNextObservationAt がテンプレ stage 間隔（定数 SCHEDULE_STAGE_INTERVAL_DAYS）から next_observation_at を算出。projectHomeSummary が近接／超過を都度再計算（常駐 DB 禁止・不変条項①）。cron 常駐配線は人間ゲート（後波）。
 */
export interface ObsSchedule {
  /**
   * スケジュールの一意キー。
   */
  schedule_id: string;
  /**
   * 対象個体の individual_id。
   */
  individual_id: string;
  /**
   * 次回観測予定時刻（RFC3339）。
   */
  next_observation_at: string;
  /**
   * 対象の成長ステージ（令齢等・任意）。間隔算出のキー。
   */
  stage?: string;
  /**
   * 次回観測に用いるテンプレの template_id（任意）。
   */
  template_id?: string;
  /**
   * 記録者の actor_id（V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 記録時刻（RFC3339・任意）。
   */
  created_at?: string;
}
