// GENERATED FILE — do not edit by hand.
// source: schemas/events/ops-cron-heartbeat.schema.json
// title: Cron heartbeat event (ihl.ops.cron_heartbeat.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * V3-FND-34: バッチ/cron失敗の監視・ハートビート通知。handleScheduled(apps/api/src/batch.ts)の毎回起動(日次)で1件 append し、無人運用でも「動いているか/どのジョブが失敗したか」を Truth 上で追跡可能にする(無音=一定期間ハートビートが無いこと自体が異常のシグナル)。Truth キー truth/ihl.ops.cron_heartbeat.v1/<YYYY-MM-DD>.json(put-if-absent・日次1件)。
 */
export interface OpsCronHeartbeat {
  /**
   * 冪等キー(YYYY-MM-DD)。
   */
  heartbeat_id: string;
  /**
   * cron 起動時刻(RFC3339)。
   */
  ran_at: string;
  /**
   * 月次バッチ本体(RECOVERY_BASE_DAY基準)が実行された日かどうか。false の日は no-op 起動の記録のみ(jobs は空配列)。
   */
  is_recovery_day: boolean;
  /**
   * is_recovery_day=true の日に実行された各ジョブの成否。
   */
  jobs: {
    name: string;
    status: "ok" | "failed";
    error?: string;
  }[];
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
