// C5 K1 match preference TC (design-k1 §3 / V3-IND-07). Drives the real app
// through the auth gate (DEV_TOKEN bearer). Preference weight is w←w+α·y·x;
// ranking is inner-product descending and the score is NOT exposed.
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, deriveActorId } from "@ihl/truth";
import { projectPreferenceWeights, rankByPreference, projectMatchConvergence } from "../apps/api/src/match-routes";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const JSON_HEADERS = { "content-type": "application/json" };
const AUTH = { Authorization: `Bearer ${DEV_TOKEN}` };
const AUTH_JSON = { ...AUTH, ...JSON_HEADERS };
const DEV_ACTOR = await deriveActorId("dev@ihl.local");

function ctx() {
  const bucket = new FakeR2Bucket();
  return { bucket, env: makeEnv(bucket) };
}
async function pref(env: object, body: Record<string, unknown>) {
  return app.request("/api/v1/match/preference", { method: "POST", headers: AUTH_JSON, body: JSON.stringify(body) }, env);
}

describe("IND-07 preference learning w <- w + alpha*y*x", () => {
  it("reduces preference events into a weight vector", async () => {
    const { env, bucket } = ctx();
    await pref(env, { item_id: "A", kind: "swipe", y: 1, features: [1, 0] });
    await pref(env, { item_id: "B", kind: "pass", y: -1, features: [0, 1] });
    const w = await projectPreferenceWeights(new TruthStore(bucket), DEV_ACTOR);
    expect(w[0]).toBeCloseTo(0.1, 10); // +alpha*(+1)*1
    expect(w[1]).toBeCloseTo(-0.1, 10); // +alpha*(-1)*1
  });

  it("ranking is inner-product descending and never leaks score", async () => {
    const { env } = ctx();
    await pref(env, { item_id: "A", kind: "swipe", y: 1, features: [1, 0] });
    await pref(env, { item_id: "B", kind: "pass", y: -1, features: [0, 1] });
    const body = (await (await app.request("/api/v1/match/ranking", { headers: AUTH }, env)).json()) as {
      ranking: Record<string, unknown>[];
    };
    expect(body.ranking.map((r) => r.item_id)).toEqual(["A", "B"]); // dot(w,A)=.1 > dot(w,B)=-.1
    for (const item of body.ranking) {
      expect("score" in item).toBe(false);
      expect("features" in item).toBe(false);
    }
  });

  it("valuecheck kind is accepted; invalid y is rejected 400", async () => {
    const { env } = ctx();
    expect((await pref(env, { item_id: "C", kind: "valuecheck", y: 1, features: [0.5] })).status).toBe(201);
    expect((await pref(env, { item_id: "D", kind: "swipe", y: 0, features: [1] })).status).toBe(400);
    expect((await pref(env, { item_id: "E", kind: "nope", y: 1, features: [1] })).status).toBe(400);
  });
});

describe("IND-07 rankByPreference pure fn", () => {
  it("orders by w·x descending, stable on ties, strips features", () => {
    const w = [1, 0];
    const out = rankByPreference(w, [
      { item_id: "lo", features: [0, 1] },
      { item_id: "hi", features: [2, 0] },
      { item_id: "mid", features: [1, 0] },
    ]);
    expect(out.map((o) => o.item_id)).toEqual(["hi", "mid", "lo"]);
    expect(out.every((o) => !("features" in o))).toBe(true);
  });
});

describe("IND-08 projectMatchConvergence (evaluation log — Precision@K/AUC/separation)", () => {
  it("no events → n_events=0, auc/precision/separation null, converged=false", async () => {
    const { env, bucket } = ctx();
    void env;
    const report = await projectMatchConvergence(new TruthStore(bucket), DEV_ACTOR);
    expect(report.n_events).toBe(0);
    expect(report.auc).toBeNull();
    expect(report.precision_at_k.value).toBeNull();
    expect(report.score_separation).toBeNull();
    expect(report.vector_change).toBe(0);
    expect(report.learning_stability_index).toBeNull();
    expect(report.converged).toBe(false);
  });

  it("perfectly separable labels → AUC=1, precision@k=1, converged=true", async () => {
    const { env, bucket } = ctx();
    // 2 positives with a large first feature, 2 negatives with a large second
    // feature; the learned weight favors feature 0 for positives.
    await pref(env, { item_id: "p1", kind: "swipe", y: 1, features: [1, 0] });
    await pref(env, { item_id: "p2", kind: "swipe", y: 1, features: [1, 0] });
    await pref(env, { item_id: "n1", kind: "pass", y: -1, features: [0, 1] });
    await pref(env, { item_id: "n2", kind: "pass", y: -1, features: [0, 1] });
    const report = await projectMatchConvergence(new TruthStore(bucket), DEV_ACTOR, 2);
    expect(report.n_events).toBe(4);
    expect(report.auc).toBe(1);
    expect(report.precision_at_k).toEqual({ k: 2, value: 1 });
    expect(report.score_separation).toBeGreaterThan(0);
    expect(report.converged).toBe(true);
  });

  it("vector_change reflects the LAST event's step magnitude (alpha*|y|*||x||)", async () => {
    const { env, bucket } = ctx();
    await pref(env, { item_id: "a", kind: "swipe", y: 1, features: [3, 4] }); // ||x||=5
    const report = await projectMatchConvergence(new TruthStore(bucket), DEV_ACTOR);
    expect(report.vector_change).toBeCloseTo(0.1 * 1 * 5, 10);
    expect(report.learning_stability_index).toBeNull(); // <2 events → undefined variance
  });

  it("GET /match/convergence route reachable + respects ?k=", async () => {
    const { env } = ctx();
    await pref(env, { item_id: "x", kind: "swipe", y: 1, features: [1] });
    const res = await app.request("/api/v1/match/convergence?k=1", { headers: AUTH }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { precision_at_k: { k: number } };
    expect(body.precision_at_k.k).toBe(1);
  });
});
