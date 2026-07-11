// V3-AIP-35/36 intent ledger contract (design-k8 §3).
// appendIntent is a PURE write helper (not a route): envelope.id === intent_id
// makes the generic putEvent converge to truth/ihl.process.intent.v1/<intent_id>.json,
// so a duplicate intent_id is a put-if-absent 409 (append-only, no UPDATE/DELETE).
// The POST /events network path converges to the SAME key (K8 adds no new route).
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, ulid, deriveActorId } from "@ihl/truth";
import { appendIntent, projectIntentChain, INTENT_TYPE } from "../apps/api/src/intent";
import type { IntentData } from "../apps/api/src/intent";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const AUTH = { Authorization: `Bearer ${DEV_TOKEN}`, "content-type": "application/json" };
const DEV_ACTOR = await deriveActorId("dev@ihl.local");

function makeIntentData(overrides: Partial<IntentData> = {}): IntentData {
  return {
    intent_id: ulid(),
    spec_version: "srs-v1.7",
    intent_summary: "machine guard for RTM closure",
    problem_statement: "requirements can drift from tests silently",
    expected_effect: "lint fails when an implemented req has no TC",
    created_at: new Date().toISOString(),
    schema_version: "1",
    ...overrides,
  };
}

describe("V3-AIP-35 appendIntent (pure write helper)", () => {
  it("first append inserts, second append with same intent_id conflicts (put-if-absent 409)", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    const data = makeIntentData();

    const first = await appendIntent(s, DEV_ACTOR, data);
    expect(first.status).toBe("inserted");
    if (first.status === "inserted") {
      expect(first.key).toBe(`truth/${INTENT_TYPE}/${data.intent_id}.json`);
    }

    // append-only: re-put of the same intent_id (even with different body) is rejected.
    const second = await appendIntent(s, DEV_ACTOR, { ...data, intent_summary: "tampered" });
    expect(second.status).toBe("conflict");
  });

  it("stamps provenance.actor_id from the caller (session principal)", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    const data = makeIntentData();
    await appendIntent(s, DEV_ACTOR, data);
    const ev = await s.readEvent(`truth/${INTENT_TYPE}/${data.intent_id}.json`);
    expect((ev?.provenance as { actor_id?: string })?.actor_id).toBe(DEV_ACTOR);
  });

  it("TruthStore exposes NO update and NO delete (append-only is the contract, CL-12 pattern)", () => {
    const s = new TruthStore(new FakeR2Bucket());
    expect(typeof (s as Record<string, unknown>)["update"]).toBe("undefined");
    expect(typeof (s as Record<string, unknown>)["delete"]).toBe("undefined");
  });
});

describe("V3-AIP-35 POST /events converges to the same intent key", () => {
  function intentEnvelope(data: IntentData) {
    return {
      specversion: "1.0",
      id: data.intent_id, // envelope.id === intent_id
      source: "apps/api",
      type: INTENT_TYPE,
      time: new Date().toISOString(),
      dataschema: "schemas/events/intent.schema.json",
      provenance: { generator_kind: "human", actor_id: DEV_ACTOR },
      data,
    };
  }

  it("network POST inserts once then 409s on the same intent_id", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const data = makeIntentData();

    const first = await app.request("/events", {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify(intentEnvelope(data)),
    }, env);
    expect(first.status).toBe(201);
    expect((await first.json()).key).toBe(`truth/${INTENT_TYPE}/${data.intent_id}.json`);

    const second = await app.request("/events", {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify(intentEnvelope(data)),
    }, env);
    expect(second.status).toBe(409);
  });

  it("helper-written intent then network POST of same intent_id is a 409 (paths converge)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const data = makeIntentData();

    expect((await appendIntent(new TruthStore(bucket), DEV_ACTOR, data)).status).toBe("inserted");

    const res = await app.request("/events", {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify(intentEnvelope(data)),
    }, env);
    expect(res.status).toBe(409);
  });
});

describe("V3-AIP-35 projectIntentChain (pure projection, recomputed)", () => {
  it("returns the unique intent_id -> spec_version -> commit_id -> post_id chain", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    const data = makeIntentData({ commit_id: "abc123", post_id: null });
    await appendIntent(s, DEV_ACTOR, data);
    // an unrelated intent must not leak into the projection
    await appendIntent(s, DEV_ACTOR, makeIntentData({ spec_version: "other" }));

    const chain = await projectIntentChain(s, data.intent_id);
    expect(chain).toEqual({
      intent_id: data.intent_id,
      spec_version: "srs-v1.7",
      commit_id: "abc123",
      post_id: null,
    });
  });

  it("returns null for an unknown intent_id", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    expect(await projectIntentChain(s, ulid())).toBeNull();
  });
});
