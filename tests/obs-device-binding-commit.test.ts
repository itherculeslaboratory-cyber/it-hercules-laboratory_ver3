// V3-OBS-17 TC: observation commit時にdevices[]を宣言するとDeviceBinding/
// Occupancyの区間が自動派生される(専用binding APIを別途呼ばない・commit1回で完結)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const AUTH = { Authorization: `Bearer ${DEV_TOKEN}` };
const AUTH_JSON = { ...AUTH, "content-type": "application/json" };

function ctx() {
  const bucket = new FakeR2Bucket();
  return { bucket, env: makeEnv(bucket) };
}
async function post(path: string, body: unknown, env: object) {
  return app.request(path, { method: "POST", headers: AUTH_JSON, body: JSON.stringify(body) }, env);
}
async function get(path: string, env: object) {
  return app.request(path, { headers: AUTH }, env);
}

async function registerDevice(env: object, placementRef: string) {
  const res = await post("/api/v1/devices", { provider: "dummy", display_name: "Shelf Sensor", placement_ref: placementRef }, env);
  return ((await res.json()) as { device_id: string }).device_id;
}

describe("OBS-17 DeviceBinding/Occupancy auto-derivation at commit", () => {
  it("solid-observation/commit with devices[] opens a binding + occupancy with no separate API call", async () => {
    const { env } = ctx();
    const deviceId = await registerDevice(env, "placement/shelf-1");

    const res = await post(
      "/api/v1/solid-observation/commit",
      { domain: "biology", subject_ref: "individual/ind-A", devices: [deviceId] },
      env,
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as { device_bindings: { device_id: string; binding_id: string; occupancy_id: string }[] };
    expect(body.device_bindings).toHaveLength(1);
    expect(body.device_bindings[0].device_id).toBe(deviceId);
    expect(body.device_bindings[0].binding_id).toBeTruthy();
    expect(body.device_bindings[0].occupancy_id).toBeTruthy();

    // GET /device-bindings shows it open, bound to the right device+placement.
    const bindings = (await (await get("/api/v1/device-bindings", env)).json()) as {
      bindings: { device_id: string; placement_id: string; open: boolean }[];
    };
    expect(bindings.bindings).toHaveLength(1);
    expect(bindings.bindings[0]).toMatchObject({ device_id: deviceId, placement_id: "placement/shelf-1", open: true });

    // GET /occupancy shows the subject occupying that placement.
    const occ = (await (await get("/api/v1/occupancy", env)).json()) as {
      occupancy: { subject_ref: string; placement_id: string; phase: string }[];
    };
    expect(occ.occupancy).toHaveLength(1);
    expect(occ.occupancy[0]).toMatchObject({ subject_ref: "individual/ind-A", placement_id: "placement/shelf-1", phase: "start" });
  });

  it("a second commit with the SAME device does NOT open a duplicate binding (二重POST防止)", async () => {
    const { env } = ctx();
    const deviceId = await registerDevice(env, "placement/shelf-2");
    await post("/api/v1/solid-observation/commit", { domain: "biology", subject_ref: "individual/ind-B", devices: [deviceId] }, env);
    const res2 = await post("/api/v1/solid-observation/commit", { domain: "biology", subject_ref: "individual/ind-B", devices: [deviceId] }, env);
    expect(res2.status).toBe(202);
    const bindings = (await (await get("/api/v1/device-bindings", env)).json()) as { bindings: unknown[] };
    expect(bindings.bindings).toHaveLength(1); // still just the one binding, reused
  });

  it("an unregistered device_id is a no-op (best-effort, does not fail the commit)", async () => {
    const { env } = ctx();
    const res = await post("/api/v1/solid-observation/commit", { domain: "biology", subject_ref: "individual/ind-C", devices: ["no-such-device"] }, env);
    expect(res.status).toBe(202);
    const body = (await res.json()) as { device_bindings: { device_id: string; binding_id: string | null }[] };
    expect(body.device_bindings[0]).toEqual({ device_id: "no-such-device", binding_id: null, binding_opened: false, occupancy_id: null, occupancy_opened: false });
  });

  it("no devices[] declared → device_bindings is empty (backward compatible)", async () => {
    const { env } = ctx();
    const res = await post("/api/v1/solid-observation/commit", { domain: "biology" }, env);
    expect(res.status).toBe(202);
    expect(((await res.json()) as { device_bindings: unknown[] }).device_bindings).toEqual([]);
  });

  it("batch-commit kind:capture with devices[] ALSO derives the binding (same shared funnel)", async () => {
    const { env } = ctx();
    const deviceId = await registerDevice(env, "placement/shelf-3");
    const res = await post(
      "/api/v1/observation/batch-commit",
      { items: [{ kind: "capture", body: { domain: "biology", subject_ref: "individual/ind-D", devices: [deviceId] } }] },
      env,
    );
    const body = (await res.json()) as { results: { ok: boolean; device_bindings?: { device_id: string }[] }[] };
    expect(body.results[0].ok).toBe(true);
    expect(body.results[0].device_bindings).toHaveLength(1);
    expect(body.results[0].device_bindings![0].device_id).toBe(deviceId);
  });
});
