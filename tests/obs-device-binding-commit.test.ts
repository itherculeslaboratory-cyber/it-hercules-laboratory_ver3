// V3-OBS-17 TC: observation commit時にdevices[]を宣言するとDeviceBinding/
// Occupancyの区間が自動派生される(専用binding APIを別途呼ばない・commit1回で完結)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore } from "@ihl/truth";
import { issueSessionToken } from "../apps/api/src/session";
import { DEV_TOKEN, FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

const AUTH = { Authorization: `Bearer ${DEV_TOKEN}` };
const AUTH_JSON = { ...AUTH, "content-type": "application/json" };

function ctx() {
  const bucket = new FakeR2Bucket();
  return { bucket, env: makeEnv(bucket) };
}
async function post(path: string, body: unknown, env: object, headers: Record<string, string> = AUTH_JSON) {
  return app.request(path, { method: "POST", headers, body: JSON.stringify(body) }, env);
}
async function get(path: string, env: object, headers: Record<string, string> = AUTH) {
  return app.request(path, { headers }, env);
}
async function authOf(actor: string) {
  const tok = await issueSessionToken(actor, SESSION_SECRET);
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}

async function registerDevice(env: object, placementRef: string, headers: Record<string, string> = AUTH_JSON) {
  const res = await post("/api/v1/devices", { provider: "dummy", display_name: "Shelf Sensor", placement_ref: placementRef }, env, headers);
  return ((await res.json()) as { device_id: string }).device_id;
}

describe("OBS-17 DeviceBinding/Occupancy auto-derivation at commit", () => {
  it("solid-observation/commit with devices[] opens a binding + occupancy with no separate API call", async () => {
    const { env } = ctx();
    const deviceId = await registerDevice(env, "placement/shelf-1");
    // occupancy authz (Task 1, source-routes.ts deriveDeviceBindingsForCapture):
    // the auto-derived occupancy links subject_ref to the device's placement —
    // that's an ownership action, so the caller must own individual/ind-A first
    // (same DEV_TOKEN actor creates its master here) or the derivation fail-closes.
    await post("/api/v1/individuals", { individual_id: "ind-A" }, env);

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

  // Regression for the ownership bypass this file's persona R75 fix closes:
  // a capture-commit with devices[] used to auto-link ANY subject_ref onto the
  // device's placement (occupancy) with no ownership check — actor B could
  // capture-observe actor A's individual through a device B controls and
  // silently claim A's individual onto B's shelf. deriveDeviceBindingsForCapture
  // now only derives the occupancy when the caller owns the individual
  // (source-routes.ts ~L494-521); non-owner captures still succeed (observing
  // is legal) but must write ZERO occupancy events.
  it("OWNERSHIP BYPASS (persona R75): non-owner capture with devices[] derives NO occupancy for someone else's individual", async () => {
    const { env, bucket } = ctx();
    const a = await authOf("owner-a-r75");
    const b = await authOf("owner-b-r75");

    // A owns individual X (creates its master).
    const indRes = await post("/api/v1/individuals", { individual_id: "ind-r75-x" }, env, a);
    expect(indRes.status).toBe(201);

    // Device D has a placement_ref (shelf S) — registered by B, who controls it.
    const deviceId = await registerDevice(env, "placement/shelf-r75", b);

    // X has no open occupancy yet — the pre-fix code would have opened one here.
    const res = await post(
      "/api/v1/solid-observation/commit",
      { domain: "biology", subject_ref: "individual/ind-r75-x", devices: [deviceId] },
      env,
      b,
    );
    expect(res.status).toBe(202); // observing a non-owned individual stays legal
    const body = (await res.json()) as {
      device_bindings: { device_id: string; binding_id: string | null; occupancy_id: string | null; occupancy_opened: boolean }[];
    };
    expect(body.device_bindings[0].occupancy_id).toBeNull();
    expect(body.device_bindings[0].occupancy_opened).toBe(false);
    // binding itself (device usage, not subject ownership) is unaffected.
    expect(body.device_bindings[0].binding_id).toBeTruthy();

    // Ground truth: zero OCCUPANCY_TYPE events exist for individual/ind-r75-x —
    // B did not link A's individual to B's shelf.
    const occEvents = (await new TruthStore(bucket).listEvents("truth/ihl.src.occupancy.v1/"))
      .map((e) => e.data as Record<string, unknown>)
      .filter((d) => d.subject_ref === "individual/ind-r75-x");
    expect(occEvents).toHaveLength(0);

    // Positive companion: A (the actual owner) doing the SAME capture DOES
    // derive the occupancy — the fix didn't break legitimate auto-linking.
    const resOwner = await post(
      "/api/v1/solid-observation/commit",
      { domain: "biology", subject_ref: "individual/ind-r75-x", devices: [deviceId] },
      env,
      a,
    );
    expect(resOwner.status).toBe(202);
    const bodyOwner = (await resOwner.json()) as {
      device_bindings: { occupancy_id: string | null; occupancy_opened: boolean }[];
    };
    expect(bodyOwner.device_bindings[0].occupancy_id).toBeTruthy();
    expect(bodyOwner.device_bindings[0].occupancy_opened).toBe(true);

    const occEventsAfter = (await new TruthStore(bucket).listEvents("truth/ihl.src.occupancy.v1/"))
      .map((e) => e.data as Record<string, unknown>)
      .filter((d) => d.subject_ref === "individual/ind-r75-x");
    expect(occEventsAfter).toHaveLength(1);
  });
});
