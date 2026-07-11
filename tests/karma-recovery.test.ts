// KRM-03 月次カルマ救済 cron（design-k3 §2.6 / §4）。25 日基準・当月 count=0 完遂月
// のみ value +10（上限 100）・当月 count≥1 発生月は value 救済なしで count-1・時刻注入で
// 月境界を検証。KRM-06 guard（value 正増加は reason 'monthly_batch' のみ）も再確認する。
import { describe, expect, it } from "vitest";
import { TruthStore, ulid } from "@ihl/truth";
import { FakeR2Bucket } from "./helpers";
import { KARMA_TYPE, projectLedger, appendKarma } from "../apps/api/src/ledger-routes";
import { krmMonthlyRecovery } from "../apps/api/src/batch";

const LEDGER_SCHEMA = "schemas/frozen/ledger-entry.schema.json";
const ACTOR = "actor-krm03";

async function putKarma(
  s: TruthStore,
  actor: string,
  layer: "value" | "count",
  delta: number,
  reason: string,
  created_at: string,
) {
  const id = ulid();
  await s.putEvent({
    specversion: "1.0",
    id,
    source: "apps/api",
    type: KARMA_TYPE,
    time: created_at,
    dataschema: LEDGER_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actor },
    data: { karma_event_id: id, actor_id: actor, layer, delta, reason_code: reason, created_at, schema_version: 1 },
  });
}

describe("KRM-03 monthly karma recovery cron", () => {
  it("clean month (no count increase this month) -> value +10, count unchanged", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    // 先月の違反で value -30 / count 3。当月(7 月)は clean。
    await putKarma(s, ACTOR, "value", -30, "dispute", "2026-06-15T00:00:00Z");
    await putKarma(s, ACTOR, "count", 3, "dispute", "2026-06-15T00:00:00Z");

    await krmMonthlyRecovery(s, new Date("2026-07-25T15:00:00Z"));

    const p = await projectLedger(s, ACTOR);
    expect(p.karma_value).toBe(-20); // -30 + 10
    expect(p.karma_count).toBe(3); // 救済月は count を触らない
  });

  it("violation this month -> count-1, no value recovery", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await putKarma(s, ACTOR, "count", 2, "dispute", "2026-07-10T00:00:00Z");
    await putKarma(s, ACTOR, "value", -3, "dispute", "2026-07-10T00:00:00Z");

    await krmMonthlyRecovery(s, new Date("2026-07-25T15:00:00Z"));

    const p = await projectLedger(s, ACTOR);
    expect(p.karma_count).toBe(1); // 2 - 1
    expect(p.karma_value).toBe(-3); // 救済なし
  });

  it("value recovery is capped at 100 (never exceeds max)", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await putKarma(s, ACTOR, "value", 95, "manual", "2026-06-01T00:00:00Z"); // clean 履歴

    await krmMonthlyRecovery(s, new Date("2026-07-25T15:00:00Z"));

    expect((await projectLedger(s, ACTOR)).karma_value).toBe(100); // 95 + min(10, 5)
  });

  it("already at 100 -> no recovery event appended (still 100)", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await putKarma(s, ACTOR, "value", 100, "manual", "2026-06-01T00:00:00Z");
    await krmMonthlyRecovery(s, new Date("2026-07-25T15:00:00Z"));
    expect((await projectLedger(s, ACTOR)).karma_value).toBe(100);
  });

  it("idempotent: two runs in the same month recover only once", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await putKarma(s, ACTOR, "value", -30, "dispute", "2026-06-15T00:00:00Z");
    const now = new Date("2026-07-25T15:00:00Z");
    await krmMonthlyRecovery(s, now);
    await krmMonthlyRecovery(s, now); // 二重起動
    expect((await projectLedger(s, ACTOR)).karma_value).toBe(-20); // +10 once, not +20
  });
});

describe("KRM-06 value guard (only monthly_batch may raise value)", () => {
  it("value increase throws for non monthly_batch reason (contribution never lands on karma value)", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await expect(appendKarma(s, ACTOR, "value", 5, "manual")).rejects.toThrow();
    await expect(appendKarma(s, ACTOR, "value", 5, "monthly_batch")).resolves.toBeUndefined();
  });
});
