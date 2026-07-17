// V3-FND-34 — バッチ/cron失敗の監視・ハートビート通知(round-16 Q-REQ-07②)。
// handleScheduled は起動の都度(no-op の日も含め) truth/ihl.ops.cron_heartbeat.v1/
// <YYYY-MM-DD>.json を append し、失敗ジョブがあれば sendOpsAlert を試みる(鍵未設定
// なら no-op degrade)。「無音」検知は外部監視がこのイベント列の間隔を見て行う前提
// (cron 自身は自分の無音を検知できない — ここでは "起動時に確実に記録が残る" ことを
// 検証する)。
import { describe, expect, it } from "vitest";
import { TruthStore } from "@ihl/truth";
import { FakeR2Bucket, makeEnv } from "./helpers";
import { appendCronHeartbeat, handleScheduled, runMonthlyBatch, type JobResult } from "../apps/api/src/batch";

const HEARTBEAT_TYPE = "ihl.ops.cron_heartbeat.v1";

describe("V3-FND-34 appendCronHeartbeat", () => {
  it("appends one heartbeat event per day (idempotent key = YYYY-MM-DD)", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    const now = new Date("2026-08-01T15:00:00.000Z");
    const jobs: JobResult[] = [{ name: "krm03", status: "ok" }];
    await appendCronHeartbeat(s, now, true, jobs);
    const events = await s.listEvents(`truth/${HEARTBEAT_TYPE}/`);
    expect(events.length).toBe(1);
    const data = events[0].data as Record<string, unknown>;
    expect(data.heartbeat_id).toBe("2026-08-01");
    expect(data.is_recovery_day).toBe(true);
    expect(data.jobs).toEqual(jobs);
  });

  it("a second append on the same day is a no-op (put-if-absent, 1 per day)", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    const now = new Date("2026-08-01T15:00:00.000Z");
    await appendCronHeartbeat(s, now, false, []);
    await appendCronHeartbeat(s, now, true, [{ name: "krm03", status: "ok" }]); // conflict, silently skipped
    const events = await s.listEvents(`truth/${HEARTBEAT_TYPE}/`);
    expect(events.length).toBe(1);
    expect((events[0].data as Record<string, unknown>).is_recovery_day).toBe(false); // first write wins
  });
});

describe("V3-FND-34 handleScheduled always records a heartbeat", () => {
  it("a non-recovery-day trigger still appends a heartbeat with is_recovery_day=false, jobs=[]", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    await handleScheduled({ scheduledTime: new Date("2026-08-05T15:00:00.000Z").getTime() }, env as never);
    const s = new TruthStore(bucket);
    const events = await s.listEvents(`truth/${HEARTBEAT_TYPE}/`);
    expect(events.length).toBe(1);
    const data = events[0].data as Record<string, unknown>;
    expect(data.is_recovery_day).toBe(false);
    expect(data.jobs).toEqual([]);
  });

  it("a recovery-day (25th) trigger records all 5 jobs as ok on a clean store", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    await handleScheduled({ scheduledTime: new Date("2026-08-25T15:00:00.000Z").getTime() }, env as never);
    const s = new TruthStore(bucket);
    const events = await s.listEvents(`truth/${HEARTBEAT_TYPE}/`);
    expect(events.length).toBe(1);
    const data = events[0].data as Record<string, unknown>;
    expect(data.is_recovery_day).toBe(true);
    const jobs = data.jobs as JobResult[];
    expect(jobs.length).toBe(5);
    expect(jobs.every((j) => j.status === "ok")).toBe(true);
  });

  it("a job failure (broken TRUTH list) is recorded as status:failed with an error message", async () => {
    const brokenBucket = { list: async () => { throw new Error("boom"); } } as unknown as FakeR2Bucket;
    const now = new Date("2026-08-25T15:00:00.000Z");
    const results = await runMonthlyBatch(new TruthStore(brokenBucket), now);
    expect(results.length).toBe(5);
    expect(results.every((j) => j.status === "failed")).toBe(true);
    expect(results[0].error).toContain("boom");
  });

  it("handleScheduled does not throw even when every job fails (ops alert send is best-effort)", async () => {
    const brokenBucket = { list: async () => { throw new Error("boom"); }, put: async () => ({ status: 409 }) } as unknown as FakeR2Bucket;
    const env = { ...makeEnv(brokenBucket), RESEND_API_KEY: undefined, OPS_ALERT_EMAIL: undefined };
    await expect(
      handleScheduled({ scheduledTime: new Date("2026-08-25T15:00:00.000Z").getTime() }, env as never),
    ).resolves.toBeUndefined();
  });
});
