// C5 K1 C-USB ingest TC (design-k1 §3 / V3-OBS-44). Drives the real app through the
// auth gate (DEV_TOKEN bearer). Flow: validate input_kind -> recompute payload_hash
// (tamper check) -> stamp lineage/semantic -> put-if-absent save (409 on replay).
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const JSON_HEADERS = { "content-type": "application/json" };
const AUTH = { Authorization: `Bearer ${DEV_TOKEN}` };
const AUTH_JSON = { ...AUTH, ...JSON_HEADERS };

function ctx() {
  const bucket = new FakeR2Bucket();
  return { bucket, env: makeEnv(bucket) };
}
async function cusb(env: object, body: unknown) {
  return app.request("/api/v1/cusb", { method: "POST", headers: AUTH_JSON, body: JSON.stringify(body) }, env);
}

describe("OBS-44 C-USB ingest", () => {
  it("validates, stamps lineage/semantic, and saves (201)", async () => {
    const { env, bucket } = ctx();
    const res = await cusb(env, { input_kind: "sensor", payload: { temp_c: 24.5 }, semantic: { tag: "terrarium" } });
    expect(res.status).toBe(201);
    const out = await res.json() as { payload_hash: string; input_kind: string };
    expect(out.input_kind).toBe("sensor");
    expect(out.payload_hash).toMatch(/^[0-9a-f]{64}$/);

    // stored envelope carries server-stamped lineage (input_kind/ingested_by) and
    // the client semantic, keyed by payload_hash.
    const stored = JSON.parse(bucket.objects.get(`truth/ihl.cusb.ingest.v1/${out.payload_hash}.json`)!.body as string);
    expect(stored.data.lineage.input_kind).toBe("sensor");
    expect(stored.data.lineage.ingested_by).toBe(stored.data.actor_id);
    expect(stored.data.semantic.tag).toBe("terrarium");
  });

  it("rejects an unknown input_kind with 400", async () => {
    const { env } = ctx();
    expect((await cusb(env, { input_kind: "telepathy", payload: { a: 1 } })).status).toBe(400);
  });

  it("rejects a payload_hash that does not match the payload (tamper) with 400", async () => {
    const { env } = ctx();
    const res = await cusb(env, { input_kind: "file", payload: { a: 1 }, payload_hash: "deadbeef" });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe("PAYLOAD_HASH_MISMATCH");
  });

  it("hash is order-independent and replay of the same payload is 409", async () => {
    const { env } = ctx();
    const first = await cusb(env, { input_kind: "screen", payload: { a: 1, b: 2 } });
    expect(first.status).toBe(201);
    // same payload, different key order -> same canonical hash -> duplicate.
    const replay = await cusb(env, { input_kind: "screen", payload: { b: 2, a: 1 } });
    expect(replay.status).toBe(409);
  });

  it("accepts a client payload_hash that matches the recomputed hash", async () => {
    const { env } = ctx();
    const seed = await cusb(env, { input_kind: "api", payload: { k: "v" } });
    const hash = (await seed.json() as { payload_hash: string }).payload_hash;
    // resend with the correct hash but a different input_kind -> same payload_hash
    // key -> 409 (idempotent by payload), proving the hash matched (not a 400).
    expect((await cusb(env, { input_kind: "human", payload: { k: "v" }, payload_hash: hash })).status).toBe(409);
  });
});
