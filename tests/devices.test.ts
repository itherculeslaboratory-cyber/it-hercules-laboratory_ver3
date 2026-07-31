// C5 K1 device TC (design-k1 §3 / V3-OBS-31 / V3-SEC-03). Drives the real app
// through the auth gate (DEV_TOKEN bearer). Device binds to a placement
// (individual -> 400); the provider API key is NEVER stored server-side, in any
// form (第20回裁定DK-1 — サーバー側AES-GCM保管の廃止). The client supplies the
// key per-call via the `x-device-api-key` header only when exercising
// POST /devices/:id/test; the server never persists it.
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore } from "@ihl/truth";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

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
  it("placement binding OK; no key material accepted or stored server-side", async () => {
    const { env, bucket } = ctx();
    const res = await createDevice(env, {
      provider: "dummy",
      display_name: "Shelf Sensor",
      placement_ref: "placement/shelf-1",
      started_on: "2026-07-11",
      api_key: PLAINTEXT, // ignored — registration carries no key field (V3-SEC-03)
    });
    expect(res.status).toBe(201);
    const deviceId = ((await res.json()) as { device_id: string }).device_id;

    // list shows display_name; there is no key-related field at all anymore.
    const list = (await (await app.request("/api/v1/devices", { headers: AUTH }, env)).json()) as {
      devices: Record<string, unknown>[];
    };
    const d = list.devices[0];
    expect(d.display_name).toBe("Shelf Sensor");
    expect("has_api_key" in d).toBe(false);
    expect(JSON.stringify(list)).not.toContain(PLAINTEXT); // no plaintext

    // Truth itself carries no key material — no ciphertext, no plaintext.
    const rec = await new TruthStore(bucket).readEvent(`truth/ihl.obs.device.v1/${deviceId}.json`);
    const data = (rec!.data as Record<string, unknown>);
    expect(JSON.stringify(rec)).not.toContain(PLAINTEXT);
    expect("api_key_ciphertext" in data).toBe(false);
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

  it("dummy provider testConnection succeeds + auto-discovers via client-supplied header key", async () => {
    const { env } = ctx();
    const res = await createDevice(env, { provider: "dummy", display_name: "S" });
    const deviceId = ((await res.json()) as { device_id: string }).device_id;
    const test = (await (
      await app.request(
        `/api/v1/devices/${deviceId}/test`,
        { method: "POST", headers: { ...AUTH_JSON, "x-device-api-key": PLAINTEXT }, body: "{}" },
        env,
      )
    ).json()) as { ok: boolean; discovered: string[] };
    expect(test.ok).toBe(true);
    expect(test.discovered.length).toBeGreaterThan(0);
  });

  it("test without a client-supplied key -> connectable=false, no discovery", async () => {
    const { env } = ctx();
    const res = await createDevice(env, { provider: "dummy", display_name: "No Key" });
    const deviceId = ((await res.json()) as { device_id: string }).device_id;
    const test = (await (
      await app.request(`/api/v1/devices/${deviceId}/test`, { method: "POST", headers: AUTH_JSON, body: "{}" }, env)
    ).json()) as { ok: boolean; discovered: string[] };
    expect(test.ok).toBe(false);
    expect(test.discovered.length).toBe(0);
  });

  it("test on unknown device -> 404", async () => {
    const { env } = ctx();
    const res = await app.request("/api/v1/devices/nope/test", { method: "POST", headers: AUTH_JSON, body: "{}" }, env);
    expect(res.status).toBe(404);
  });
});
