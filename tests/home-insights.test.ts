// C5 K1 home/insights + schedule TC (design-k1 §3 / V3-OBS-21/43). Drives the real
// app through the auth gate (DEV_TOKEN bearer). computeNextObservationAt is a pure
// deterministic fn; home/summary classifies the latest schedule per individual as
// overdue / near / observing; insights detects overdue + missing-observation gaps.
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, deriveActorId, ulid } from "@ihl/truth";
import { computeNextObservationAt, projectCivMinimap } from "../apps/api/src/home-routes";
import { appendKarma } from "../apps/api/src/ledger-routes";
import { appendTemplateVersion } from "../apps/api/src/culture";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const JSON_HEADERS = { "content-type": "application/json" };
const AUTH = { Authorization: `Bearer ${DEV_TOKEN}` };
const AUTH_JSON = { ...AUTH, ...JSON_HEADERS };
const DAY = 86_400_000;

function ctx() {
  const bucket = new FakeR2Bucket();
  return { bucket, env: makeEnv(bucket) };
}
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY).toISOString();
async function sched(env: object, body: Record<string, unknown>) {
  return app.request("/api/v1/observation/schedule", { method: "POST", headers: AUTH_JSON, body: JSON.stringify(body) }, env);
}
async function newIndividual(env: object): Promise<string> {
  const r = await app.request("/api/v1/individuals", { method: "POST", headers: AUTH_JSON, body: "{}" }, env);
  return (await r.json() as { individual_id: string }).individual_id;
}
async function capture(env: object, individualId: string) {
  return app.request(
    "/api/v1/observation/captures",
    { method: "POST", headers: AUTH_JSON, body: JSON.stringify({ domain: "biology", subject_ref: `individual/${individualId}` }) },
    env,
  );
}

describe("OBS-21 computeNextObservationAt (pure)", () => {
  it("adds the frozen stage interval in days to from", () => {
    expect(computeNextObservationAt(null, "first_to_second", "2026-01-01T00:00:00.000Z"))
      .toBe("2026-01-31T00:00:00.000Z"); // +30 days
  });
  it("prefers a template-supplied interval over the constant", () => {
    expect(computeNextObservationAt({ stage_interval_days: { first_to_second: 7 } }, "first_to_second", "2026-01-01T00:00:00.000Z"))
      .toBe("2026-01-08T00:00:00.000Z");
  });
  it("returns null for an unknown stage or a bad from", () => {
    expect(computeNextObservationAt(null, "no_such_stage", "2026-01-01T00:00:00.000Z")).toBeNull();
    expect(computeNextObservationAt(null, "first_to_second", "not-a-date")).toBeNull();
  });
});

describe("OBS-21 schedule INSERT + home/summary", () => {
  it("INSERTs a schedule from computeNextObservationAt and classifies near/overdue/observing", async () => {
    const { env } = ctx();
    // overdue: from 100d ago +30d -> 70d ago; near: from 29d ago +30d -> +1d;
    // observing: from now +30d -> +30d.
    const over = await newIndividual(env);
    const near = await newIndividual(env);
    const obsv = await newIndividual(env);
    expect((await sched(env, { individual_id: over, stage: "first_to_second", from: daysFromNow(-100) })).status).toBe(201);
    expect((await sched(env, { individual_id: near, stage: "first_to_second", from: daysFromNow(-29) })).status).toBe(201);
    expect((await sched(env, { individual_id: obsv, stage: "first_to_second", from: daysFromNow(0) })).status).toBe(201);

    const body = await (await app.request("/api/v1/home/summary", { headers: AUTH }, env)).json() as {
      overdue: { individual_id: string }[]; near: { individual_id: string }[]; observing: { individual_id: string }[];
    };
    expect(body.overdue.map((s) => s.individual_id)).toEqual([over]);
    expect(body.near.map((s) => s.individual_id)).toEqual([near]);
    expect(body.observing.map((s) => s.individual_id)).toEqual([obsv]);
  });

  it("uses the LATEST schedule per individual (append-only, last wins)", async () => {
    const { env } = ctx();
    const id = await newIndividual(env);
    await sched(env, { individual_id: id, stage: "first_to_second", from: daysFromNow(-100) }); // overdue
    await sched(env, { individual_id: id, stage: "first_to_second", from: daysFromNow(0) });    // observing
    const body = await (await app.request("/api/v1/home/summary", { headers: AUTH }, env)).json() as {
      overdue: unknown[]; observing: { individual_id: string }[];
    };
    expect(body.overdue).toEqual([]);
    expect(body.observing.map((s) => s.individual_id)).toEqual([id]);
  });

  it("rejects an unknown stage with 400", async () => {
    const { env } = ctx();
    expect((await sched(env, { individual_id: "x", stage: "bogus", from: daysFromNow(0) })).status).toBe(400);
  });
});

describe("V3-UIX-27 today_lines (overdue→near merged, capped at 3, deep-linked)", () => {
  it("merges overdue before near and caps at 3, dropping the 4th line", async () => {
    const { env } = ctx();
    const over1 = await newIndividual(env); // most overdue
    const over2 = await newIndividual(env);
    const near1 = await newIndividual(env); // soonest upcoming
    const near2 = await newIndividual(env); // 4th line — must be dropped
    await sched(env, { individual_id: over1, stage: "first_to_second", from: daysFromNow(-200) });
    await sched(env, { individual_id: over2, stage: "first_to_second", from: daysFromNow(-100) });
    await sched(env, { individual_id: near1, stage: "first_to_second", from: daysFromNow(-29) });
    await sched(env, { individual_id: near2, stage: "first_to_second", from: daysFromNow(-28) });

    const body = await (await app.request("/api/v1/home/summary", { headers: AUTH }, env)).json() as {
      today_lines: { individual_id: string; days: number; overdue: boolean; deep_link: string }[];
    };
    expect(body.today_lines.map((l) => l.individual_id)).toEqual([over1, over2, near1]);
    expect(body.today_lines[0].overdue).toBe(true);
    expect(body.today_lines[2].overdue).toBe(false);
    expect(body.today_lines[0].deep_link).toBe(`/s/obs-register-entry?id=${over1}`);
  });
});

describe("V3-UIX-26 ホーム文明ミニマップ(非PII集計3指標)", () => {
  it("projectCivMinimap: 空Truthは中立フォールバック相当(trust_avg=50・件数0)", async () => {
    const stats = await projectCivMinimap(new TruthStore(new FakeR2Bucket()));
    expect(stats).toEqual({ observation_pace_7d: 0, trust_avg: 50, template_growth: 0 });
  });

  it("projectCivMinimap: 個別actorの値を出さず平均trust/件数のみ集計する", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    const actorA = await deriveActorId("civ-a@ihl.local");
    const actorB = await deriveActorId("civ-b@ihl.local");
    await appendKarma(s, actorA, "value", -20, "manual"); // trust 40
    await appendKarma(s, actorB, "value", 10, "monthly_batch"); // trust 55
    await appendTemplateVersion(s, actorA, {
      template_id: "t1", version_id: ulid(), kind: "ui_theme", body: {},
      author_actor_id: actorA, created_at: new Date().toISOString(), schema_version: "1",
    });
    await appendTemplateVersion(s, actorB, {
      template_id: "t2", version_id: ulid(), kind: "ui_theme", body: {},
      author_actor_id: actorB, created_at: new Date().toISOString(), schema_version: "1",
    });

    const stats = await projectCivMinimap(s);
    expect(stats.trust_avg).toBe(47.5); // (40+55)/2 — no per-actor value exposed
    expect(stats.template_growth).toBe(2);
    // JSON has no actor_id/handle anywhere in the shape (non-PII contract).
    expect(Object.keys(stats).sort()).toEqual(["observation_pace_7d", "template_growth", "trust_avg"]);
  });

  it("GET /home/civ-minimap is protected and returns the 3-field non-PII shape", async () => {
    const { env } = ctx();
    await capture(env, await newIndividual(env));
    const body = await (await app.request("/api/v1/home/civ-minimap", { headers: AUTH }, env)).json() as {
      observation_pace_7d: number; trust_avg: number; template_growth: number;
    };
    expect(body.observation_pace_7d).toBeGreaterThanOrEqual(1);
    expect(typeof body.trust_avg).toBe("number");
    expect(typeof body.template_growth).toBe("number");
    expect((await app.request("/api/v1/home/civ-minimap", {}, env)).status).toBe(401); // deny-by-default
  });
});

describe("OBS-43 insights gap detection", () => {
  it("lists overdue individuals and masters with zero observations", async () => {
    const { env } = ctx();
    const overdueId = await newIndividual(env);   // has an overdue schedule
    const observedId = await newIndividual(env);  // has a capture, no schedule
    const emptyId = await newIndividual(env);     // master only, no capture/schedule
    await sched(env, { individual_id: overdueId, stage: "first_to_second", from: daysFromNow(-100) });
    expect((await capture(env, observedId)).status).toBe(202);

    const gaps = await (await app.request("/api/v1/observation/insights", { headers: AUTH }, env)).json() as {
      overdue: { individual_id: string }[]; missing_observation: { individual_id: string }[];
    };
    expect(gaps.overdue.map((g) => g.individual_id)).toEqual([overdueId]);
    const missing = gaps.missing_observation.map((g) => g.individual_id);
    expect(missing).toContain(overdueId); // overdue but never actually observed
    expect(missing).toContain(emptyId);
    expect(missing).not.toContain(observedId); // has a capture
  });
});
