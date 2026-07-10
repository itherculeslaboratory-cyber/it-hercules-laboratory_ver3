// CL-09 / V3-OBS-28 collector ingest route (design-c3 §3). Drives the real app
// end-to-end against the C1 Ed25519 fixture (fresh test keypair, private key
// discarded at build → we can only REPLAY the fixed signature). Covers:
// valid signature → 202 + event stored with device provenance; tampered payload
// → 401 nothing stored; corrupted signature → 401; unknown collector → 401;
// replay of the same signed message → 409 (append-only idempotency); route is
// public at the session layer (no bearer needed — signature is the credential).
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore } from "@ihl/truth";
import { FakeR2Bucket, makeEnv } from "./helpers";
import { loadFixture } from "./helpers";

type Fixture = {
  collector_id: string;
  timestamp: string;
  payload: Record<string, unknown>;
  signature_base64: string;
  public_key_pem: string;
  tampered: { payload: Record<string, unknown>; signature_base64: string };
};
const f = loadFixture<Fixture>("cl-09-ed25519-fixture.json");

const JSON_HEADERS = { "content-type": "application/json" };

function ctx() {
  const bucket = new FakeR2Bucket();
  const env = {
    ...makeEnv(bucket),
    COLLECTOR_PUBLIC_KEYS: JSON.stringify({ [f.collector_id]: f.public_key_pem }),
  };
  return { bucket, env };
}

function ingest(body: unknown, env: object) {
  return app.request(
    "/api/v1/collector/ingest",
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) },
    env,
  );
}

const genuine = {
  collector_id: f.collector_id,
  timestamp: f.timestamp,
  payload: f.payload,
  signature_base64: f.signature_base64,
};

describe("§3 collector ingest — Ed25519 signature is the credential", () => {
  it("valid signature → 202 and appends a device-provenance event (no session)", async () => {
    const { bucket, env } = ctx();
    const res = await ingest(genuine, env);
    expect(res.status).toBe(202);
    const { key } = (await res.json()) as { key: string };

    const ev = await new TruthStore(bucket).readEvent(key);
    expect(ev).not.toBeNull();
    expect(ev!.type).toBe("ihl.collector.ingest.v1");
    expect((ev!.provenance as { generator_kind: string; device_id: string })).toEqual({
      generator_kind: "device",
      device_id: f.collector_id,
    });
    // verified payload carried verbatim + collector attribution
    expect((ev!.data as { payload: unknown }).payload).toEqual(f.payload);
    expect((ev!.data as { actor_id: string }).actor_id).toBe(f.collector_id);
  });

  it("tampered payload (genuine signature) → 401 COLLECTOR_SIGNATURE_INVALID, nothing stored", async () => {
    const { bucket, env } = ctx();
    const res = await ingest({ ...genuine, payload: f.tampered.payload }, env);
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: string }).toEqual({ error: "COLLECTOR_SIGNATURE_INVALID" });
    const { objects } = await bucket.list({ prefix: "truth/ihl.collector.ingest.v1/" });
    expect(objects).toHaveLength(0);
  });

  it("corrupted signature over the genuine message → 401", async () => {
    const { env } = ctx();
    const sig = Uint8Array.from(atob(f.signature_base64), (ch) => ch.charCodeAt(0));
    sig[0] ^= 0xff;
    const corrupted = btoa(String.fromCharCode(...sig));
    const res = await ingest({ ...genuine, signature_base64: corrupted }, env);
    expect(res.status).toBe(401);
  });

  it("unknown collector_id (no registered key) → 401 COLLECTOR_UNKNOWN", async () => {
    const { env } = ctx();
    const res = await ingest({ ...genuine, collector_id: "collector-not-registered" }, env);
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: string }).toEqual({ error: "COLLECTOR_UNKNOWN" });
  });

  it("replay of the same signed message → 409 (append-only idempotency)", async () => {
    const { env } = ctx();
    expect((await ingest(genuine, env)).status).toBe(202);
    const dup = await ingest(genuine, env);
    expect(dup.status).toBe(409);
  });

  it("malformed body (missing signature) → 400", async () => {
    const { env } = ctx();
    const res = await ingest({ collector_id: f.collector_id, timestamp: f.timestamp, payload: f.payload }, env);
    expect(res.status).toBe(400);
  });

  it("no collector keys configured → 401 (not a 500)", async () => {
    const bucket = new FakeR2Bucket();
    const res = await ingest(genuine, makeEnv(bucket)); // no COLLECTOR_PUBLIC_KEYS
    expect(res.status).toBe(401);
  });
});
