// C5 K1 C-USB ingest TC (design-k1 §3 / V3-OBS-44). Drives the real app through the
// auth gate (DEV_TOKEN bearer). Flow: validate input_kind -> recompute payload_hash
// (tamper check) -> stamp lineage/semantic -> put-if-absent save (409 on replay).
//
// V3-OBS-70 段階1 (design R0731-060798 §5案B): device-signature 経路のTC群を追加。
// このrouteはまだ index.ts の PUBLIC_ROUTES に無い(mount待ち)ため、署名経路も
// DEV_TOKEN セッション越しにしか到達できない — この制約自体を最初のTCで固定する。
// 鍵は cl-09-ed25519-fixture.json を再利用せず、テストごとに generateKeyPairSync で
// 新規生成する(signed message に input_kind を含める設計にしたため、既存fixtureの
// 署名済みメッセージ文字列とは形が違う。秘密鍵はここでのみ使い捨て・永続化しない)。
import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { TruthStore } from "@ihl/truth";
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

// Recursively-sorted-key canonical JSON, mirrors cusb-routes.ts's own `canonical()`.
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = canonical((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

function makeDevice(actorId: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const extensionId = "ext-obs70-fixture-01";
  const env = { CUSB_DEVICE_KEYS: JSON.stringify({ [extensionId]: { public_key_pem: pem, actor_id: actorId } }) };
  function signedBody(
    inputKind: string,
    payload: unknown,
    timestamp = "1783680913411",
    lineage: Record<string, unknown> = {},
    semantic: Record<string, unknown> = {},
  ) {
    const message = `${timestamp}.${JSON.stringify(canonical({ input_kind: inputKind, payload, lineage, semantic }))}`;
    const sig = sign(null, Buffer.from(message), privateKey).toString("base64");
    return { input_kind: inputKind, payload, lineage, semantic, device_id: extensionId, timestamp, signature_base64: sig };
  }
  return { extensionId, env, signedBody };
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

describe("OBS-70 段階1 — C-USB device-signature path (unattended Docker push)", () => {
  it("valid signature -> 201, attributed to the key's registered actor_id, provenance=device", async () => {
    const bucket = new FakeR2Bucket();
    const device = makeDevice("actor-owner-1");
    const env = { ...makeEnv(bucket), ...device.env };
    const body = device.signedBody("api", { k: "from-docker" });
    const res = await cusb(env, body);
    expect(res.status).toBe(201);
    const out = (await res.json()) as { payload_hash: string };

    const ev = await new TruthStore(bucket).readEvent(`truth/ihl.cusb.ingest.v1/${out.payload_hash}.json`);
    expect(ev!.provenance).toEqual({ generator_kind: "device", device_id: device.extensionId });
    expect((ev!.data as { actor_id: string }).actor_id).toBe("actor-owner-1");
  });

  it("no signature and no session -> 401 AUTH_REQUIRED (route-level guard: signature or session required)", async () => {
    const device = makeDevice("actor-owner-1");
    const env = { ...makeEnv(new FakeR2Bucket()), ...device.env };
    const res = await app.request(
      "/api/v1/cusb",
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ input_kind: "api", payload: { a: 1 } }) },
      env,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "AUTH_REQUIRED" });
  });

  // R66-9恒久テスト(wave1fix艦T7実験の恒久化・index.ts側のPUBLIC_READ_ROUTES登録が
  // 恒久化されたため): 未ログイン(セッションCookie/Bearerなし)+正しい署名のリクエストが、
  // index.ts のフルミドルウェアチェーン(認証ゲート→CORS→書込レート制限→route)を経由して
  // 201 で通ること。ctx()のcusb()ヘルパーはAUTH_JSON(DEV_TOKENセッション)を常に付けるため
  // ここでは使わず、app.request を直接叩いてセッション無しを明示する。
  it("unauthenticated request with a valid signature -> 201 through the full middleware chain", async () => {
    const bucket = new FakeR2Bucket();
    const device = makeDevice("actor-owner-1");
    const env = { ...makeEnv(bucket), ...device.env };
    const body = device.signedBody("api", { k: "from-docker-unauth" });
    const res = await app.request(
      "/api/v1/cusb",
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) },
      env,
    );
    expect(res.status).toBe(201);
  });

  it("signature from an unregistered/other extension_id -> 401 CUSB_DEVICE_UNKNOWN, nothing stored", async () => {
    const bucket = new FakeR2Bucket();
    const device = makeDevice("actor-owner-1");
    const env = { ...makeEnv(bucket), ...device.env };
    const body = { ...device.signedBody("api", { a: 1 }), device_id: "ext-someone-elses-key" };
    const res = await cusb(env, body);
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: string }).toEqual({ error: "CUSB_DEVICE_UNKNOWN" });
    expect((await bucket.list({ prefix: "truth/ihl.cusb.ingest.v1/" })).objects).toHaveLength(0);
  });

  it("tampered payload under a genuine signature -> 401 CUSB_SIGNATURE_INVALID, nothing stored", async () => {
    const bucket = new FakeR2Bucket();
    const device = makeDevice("actor-owner-1");
    const env = { ...makeEnv(bucket), ...device.env };
    const body = { ...device.signedBody("api", { a: 1 }), payload: { a: 999 } };
    const res = await cusb(env, body);
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: string }).toEqual({ error: "CUSB_SIGNATURE_INVALID" });
    expect((await bucket.list({ prefix: "truth/ihl.cusb.ingest.v1/" })).objects).toHaveLength(0);
  });

  it("semantic swapped under an otherwise genuine signature -> 401 CUSB_SIGNATURE_INVALID, nothing stored (批評ゲート R0801-c16d84 中4)", async () => {
    const bucket = new FakeR2Bucket();
    const device = makeDevice("actor-owner-1");
    const env = { ...makeEnv(bucket), ...device.env };
    const body = { ...device.signedBody("api", { a: 1 }), semantic: { tag: "attacker-injected" } };
    const res = await cusb(env, body);
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: string }).toEqual({ error: "CUSB_SIGNATURE_INVALID" });
    expect((await bucket.list({ prefix: "truth/ihl.cusb.ingest.v1/" })).objects).toHaveLength(0);
  });

  it("valid payload+key but corrupted signature bytes -> 401", async () => {
    const device = makeDevice("actor-owner-1");
    const env = { ...makeEnv(new FakeR2Bucket()), ...device.env };
    const body = device.signedBody("api", { a: 1 });
    const sigBytes = Buffer.from(body.signature_base64, "base64");
    sigBytes[0] ^= 0xff;
    const res = await cusb(env, { ...body, signature_base64: sigBytes.toString("base64") });
    expect(res.status).toBe(401);
  });

  it("no signature present -> falls back to session principal (backward-compat, 201)", async () => {
    const { env } = ctx();
    const res = await cusb(env, { input_kind: "api", payload: { a: 1, source: "browser" } });
    expect(res.status).toBe(201);
  });

  it("replay of the same signed (input_kind, payload) -> 409 (idempotency, same as session path)", async () => {
    const bucket = new FakeR2Bucket();
    const device = makeDevice("actor-owner-1");
    const env = { ...makeEnv(bucket), ...device.env };
    const body = device.signedBody("sensor", { temp_c: 1 });
    expect((await cusb(env, body)).status).toBe(201);
    expect((await cusb(env, body)).status).toBe(409);
  });
});
