// C5 K1 device TC (design-k1 §3 / V3-OBS-31). Drives the real app through the auth
// gate (DEV_TOKEN bearer). Device binds to a placement (individual -> 400); the
// provider API key is AES-GCM encrypted and its plaintext is never stored/returned.
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore } from "@ihl/truth";
import { decryptApiKey } from "../apps/api/src/device-routes";
import { DEV_TOKEN, FakeR2Bucket, makeEnv, SESSION_SECRET } from "./helpers";

const JSON_HEADERS = { "content-type": "application/json" };
const AUTH = { Authorization: `Bearer ${DEV_TOKEN}` };
const AUTH_JSON = { ...AUTH, ...JSON_HEADERS };
const PLAINTEXT = "provider-secret-abc123";

function ctx() {
  const bucket = new FakeR2Bucket();
  return { bucket, env: makeEnv(bucket) };
}
async function createDevice(env: object, body: Record<string, unknown>) {
  return app.request("/api/v1/devices", { method: "POST", headers: AUTH_JSON, body: JSON.stringify(body) }, env);
}

describe("OBS-31 device registration (placement-bound)", () => {
  it("placement binding OK; api key stored encrypted, plaintext never exposed", async () => {
    const { env, bucket } = ctx();
    const res = await createDevice(env, {
      provider: "dummy",
      display_name: "Shelf Sensor",
      placement_ref: "placement/shelf-1",
      started_on: "2026-07-11",
      api_key: PLAINTEXT,
    });
    expect(res.status).toBe(201);
    const deviceId = ((await res.json()) as { device_id: string }).device_id;

    // list shows display_name, hides the key entirely.
    const list = (await (await app.request("/api/v1/devices", { headers: AUTH }, env)).json()) as {
      devices: Record<string, unknown>[];
    };
    const d = list.devices[0];
    expect(d.display_name).toBe("Shelf Sensor");
    expect(d.has_api_key).toBe(true);
    expect(JSON.stringify(list)).not.toContain(PLAINTEXT); // no plaintext
    expect("api_key_ciphertext" in d).toBe(false); // no ciphertext either

    // Truth carries ciphertext, not plaintext; and it decrypts back.
    const rec = await new TruthStore(bucket).readEvent(`truth/ihl.obs.device.v1/${deviceId}.json`);
    const data = (rec!.data as Record<string, unknown>);
    expect(JSON.stringify(rec)).not.toContain(PLAINTEXT);
    expect(typeof data.api_key_ciphertext).toBe("string");
    expect(await decryptApiKey(SESSION_SECRET, data.api_key_ciphertext as string)).toBe(PLAINTEXT);
  });

  it("individual binding -> 400", async () => {
    const { env } = ctx();
    const res = await createDevice(env, {
      provider: "dummy",
      display_name: "Bad",
      subject_ref: "individual/ind-1",
    });
    expect(res.status).toBe(400);
  });

  it("dummy provider testConnection succeeds + auto-discovers", async () => {
    const { env } = ctx();
    const res = await createDevice(env, { provider: "dummy", display_name: "S", api_key: PLAINTEXT });
    const deviceId = ((await res.json()) as { device_id: string }).device_id;
    const test = (await (await app.request(`/api/v1/devices/${deviceId}/test`, { method: "POST", headers: AUTH_JSON, body: "{}" }, env)).json()) as {
      ok: boolean;
      discovered: string[];
    };
    expect(test.ok).toBe(true);
    expect(test.discovered.length).toBeGreaterThan(0);
  });

  it("test on unknown device -> 404", async () => {
    const { env } = ctx();
    const res = await app.request("/api/v1/devices/nope/test", { method: "POST", headers: AUTH_JSON, body: "{}" }, env);
    expect(res.status).toBe(404);
  });
});
