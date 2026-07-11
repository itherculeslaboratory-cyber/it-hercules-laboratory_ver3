// C5 K1 match preference TC (design-k1 §3 / V3-IND-07). Drives the real app
// through the auth gate (DEV_TOKEN bearer). Preference weight is w←w+α·y·x;
// ranking is inner-product descending and the score is NOT exposed.
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, deriveActorId } from "@ihl/truth";
import { projectPreferenceWeights, rankByPreference } from "../apps/api/src/match-routes";
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
