// V3-GOV-06(未合意紛争の1ヶ月強制クローズ) + V3-KRM-09(累計5回ごとのΔcountマイルストーン)
// + V3-GOV-08(段階/カテゴリ別Δcount参照route)。it 名は ASCII。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, ulid } from "@ihl/truth";
import { projectLedger } from "../apps/api/src/ledger-routes";
import { milestoneKarmaSteps } from "../apps/api/src/gov-routes";
import { projectPt } from "../apps/api/src/contribution";
import {
  GOV06_FORCE_CLOSE_DAYS,
  KRM09_MILESTONE_STEP,
  KRM09_ZOMBIE_DISPUTE_THRESHOLD,
  KRM09_ZOMBIE_PT_COST,
} from "../apps/api/src/gov-routes-constants";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

const DISPUTE_TYPE = "ihl.gov.dispute.v1";
const DISPUTE_SCHEMA = "schemas/events/gov-dispute.schema.json";

async function seedOpen(bucket: FakeR2Bucket, disputeId: string, opener: string, respondent: string, createdAt: string) {
  const eid = ulid();
  await new TruthStore(bucket).putEventAt(`truth/${DISPUTE_TYPE}/${disputeId}/${eid}.json`, {
    specversion: "1.0", id: eid, source: "test", type: DISPUTE_TYPE, time: createdAt, dataschema: DISPUTE_SCHEMA,
    provenance: { generator_kind: "human", actor_id: opener },
    data: { dispute_id: disputeId, actor_id: opener, action: "open", category: "board", respondent_id: respondent, created_at: createdAt, schema_version: "1" },
  });
}
// force_closed の close イベントを直接 seed(過去ラウンドの既決着分を作るため)。
async function seedForceClosed(bucket: FakeR2Bucket, disputeId: string, opener: string, respondent: string, createdAt: string) {
  await seedOpen(bucket, disputeId, opener, respondent, createdAt);
  const eid = ulid();
  await new TruthStore(bucket).putEventAt(`truth/${DISPUTE_TYPE}/${disputeId}/force-close.json`, {
    specversion: "1.0", id: eid, source: "test", type: DISPUTE_TYPE, time: createdAt, dataschema: DISPUTE_SCHEMA,
    provenance: { generator_kind: "human", actor_id: opener },
    data: { dispute_id: disputeId, actor_id: opener, action: "close", resolution: "force_closed", created_at: createdAt, schema_version: "1" },
  });
}
function forceClose(env: ReturnType<typeof makeEnv>, id: string) {
  return app.request(`/api/v1/gov/disputes/${id}/force-close`, { method: "POST", headers: AUTH_HEADERS, body: "{}" }, env);
}

describe("V3-GOV-06 force-close after 1 month", () => {
  it("rejects force-close before GOV06_FORCE_CLOSE_DAYS has elapsed", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    await seedOpen(bucket, "d-recent", "alice", "bob", recent);
    const res = await forceClose(env, "d-recent");
    expect(res.status).toBe(409);
  });

  it("force-closes a dispute past GOV06_FORCE_CLOSE_DAYS with resolution=force_closed", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const past = new Date(Date.now() - (GOV06_FORCE_CLOSE_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    await seedOpen(bucket, "d-old", "alice", "bob", past);
    const res = await forceClose(env, "d-old");
    expect(res.status).toBe(201);
    expect((await res.json()) as { resolution: string }).toMatchObject({ resolution: "force_closed" });
  });

  it("is idempotent: a second force-close call reports already_closed", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const past = new Date(Date.now() - (GOV06_FORCE_CLOSE_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    await seedOpen(bucket, "d-twice", "alice", "bob", past);
    await forceClose(env, "d-twice");
    const second = await forceClose(env, "d-twice");
    expect(second.status).toBe(200);
    expect((await second.json()) as { already_closed: boolean }).toMatchObject({ already_closed: true });
  });

  it("404s for an unknown dispute", async () => {
    const env = makeEnv();
    const res = await forceClose(env, "d-missing");
    expect(res.status).toBe(404);
  });
});

describe("V3-KRM-09 milestone karma (every KRM09_MILESTONE_STEP-th force-close only)", () => {
  it("milestoneKarmaSteps returns 0 for non-multiples and the step amount on multiples", () => {
    expect(milestoneKarmaSteps(1)).toBe(0);
    expect(milestoneKarmaSteps(4)).toBe(0);
    expect(milestoneKarmaSteps(KRM09_MILESTONE_STEP)).toBeGreaterThan(0);
    expect(milestoneKarmaSteps(KRM09_MILESTONE_STEP * 2)).toBeGreaterThan(0);
    expect(milestoneKarmaSteps(KRM09_MILESTONE_STEP * 2 - 1)).toBe(0);
  });

  it("charges Δcount only when the actor's cumulative force-close count hits the 5th milestone", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const past = new Date(Date.now() - (GOV06_FORCE_CLOSE_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    // Seed 4 prior force-closed disputes for "repeat-offender" (below the 5th milestone).
    for (let i = 1; i < KRM09_MILESTONE_STEP; i++) {
      await seedForceClosed(bucket, `d-seed-${i}`, "repeat-offender", `counterpart-${i}`, past);
    }
    const before = await projectLedger(new TruthStore(bucket), "repeat-offender");
    expect(before.karma_count).toBe(0); // seeded directly, no karma side-effects applied yet

    // Open + force-close a 5th dispute for repeat-offender via the live route -> hits the milestone.
    await seedOpen(bucket, "d-live", "repeat-offender", "counterpart-live", past);
    const res = await forceClose(env, "d-live");
    expect(res.status).toBe(201);

    const after = await projectLedger(new TruthStore(bucket), "repeat-offender");
    expect(after.karma_count).toBeGreaterThan(before.karma_count); // Δcount charged on the 5th milestone
  });
});

describe("V3-KRM-09 zombie dispute fee (every KRM09_ZOMBIE_DISPUTE_THRESHOLD-th force-close only)", () => {
  it("does not charge PT below the threshold, and charges KRM09_ZOMBIE_PT_COST on the Nth", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const past = new Date(Date.now() - (GOV06_FORCE_CLOSE_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    // Seed (threshold - 1) prior force-closed disputes for "zombie-offender".
    for (let i = 1; i < KRM09_ZOMBIE_DISPUTE_THRESHOLD; i++) {
      await seedForceClosed(bucket, `d-zseed-${i}`, "zombie-offender", `zcounterpart-${i}`, past);
    }
    const s = new TruthStore(bucket);
    expect((await projectPt(s, "zombie-offender")).balance).toBe(0); // unchanged below the threshold

    // Open + force-close the Nth dispute via the live route -> hits the zombie threshold.
    await seedOpen(bucket, "d-zlive", "zombie-offender", "zcounterpart-live", past);
    const res = await forceClose(env, "d-zlive");
    expect(res.status).toBe(201);

    expect((await projectPt(s, "zombie-offender")).balance).toBe(-KRM09_ZOMBIE_PT_COST);
    const ptEvents = (await s.listEvents("truth/ihl.economy.pt_event.v1/"))
      .map((e) => e.data as Record<string, unknown>)
      .filter((d) => d.actor_id === "zombie-offender");
    expect(ptEvents).toHaveLength(1);
    expect(ptEvents[0]).toMatchObject({ delta: -KRM09_ZOMBIE_PT_COST, reason_code: "indictment_fee", ref: "gov-dispute-zombie-force-closed" });
  });

  it("does not block force-close when PT balance would go negative (non-blocking, after-the-fact fee)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const past = new Date(Date.now() - (GOV06_FORCE_CLOSE_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    for (let i = 1; i < KRM09_ZOMBIE_DISPUTE_THRESHOLD; i++) {
      await seedForceClosed(bucket, `d-zblock-${i}`, "zombie-poor", `zpcounterpart-${i}`, past);
    }
    await seedOpen(bucket, "d-zblock-live", "zombie-poor", "zpcounterpart-live", past);
    const res = await forceClose(env, "d-zblock-live");
    expect(res.status).toBe(201); // dispute force-close itself is never blocked by PT balance
  });
});

describe("V3-GOV-08 indictment-karma reference route (read-only)", () => {
  it("returns stage and category steps independently", async () => {
    const env = makeEnv();
    const res = await app.request("/api/v1/gov/indictment-karma?stage=post_payment&category=Y11", { headers: AUTH_HEADERS }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { stage_steps: number; category_steps: number };
    expect(body.stage_steps).toBe(5);
    expect(body.category_steps).toBe(10);
  });

  it("rejects an invalid stage", async () => {
    const env = makeEnv();
    const res = await app.request("/api/v1/gov/indictment-karma?stage=bogus", { headers: AUTH_HEADERS }, env);
    expect(res.status).toBe(400);
  });
});
