// C5 K1 photo_conditions TC (design-k1 §3 tests/upload-conditions) — OBS-28.
// Upload auto-fills captured_at, fires a threshold alert, and rejects spoofed
// placeholder readings. The normalized conditions ride the response so the
// confirm/commit step embeds them on the capture record.
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const AUTH = { Authorization: `Bearer ${DEV_TOKEN}` };
const AUTH_JSON = { ...AUTH, "content-type": "application/json" };

function ctx() {
  return { env: makeEnv(new FakeR2Bucket()) };
}
async function makeCapture(env: object): Promise<string> {
  const res = await app.request(
    "/api/v1/observation/captures",
    { method: "POST", headers: AUTH_JSON, body: JSON.stringify({ domain: "biology" }) },
    env,
  );
  return ((await res.json()) as { capture_id: string }).capture_id;
}
async function upload(env: object, captureId: string, conditions?: unknown) {
  const fd = new FormData();
  fd.append("capture_id", captureId);
  fd.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), "p.jpg");
  if (conditions !== undefined) fd.append("photo_conditions", JSON.stringify(conditions));
  return app.request("/api/v1/observation/upload", { method: "POST", headers: AUTH, body: fd }, env);
}

describe("OBS-28 photo_conditions auto-embed", () => {
  it("auto-fills captured_at when omitted and returns normalized conditions", async () => {
    const { env } = ctx();
    const capId = await makeCapture(env);
    const res = await upload(env, capId, { temp_c: 24, humidity_pct: 55 });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { photo_conditions: { temp_c: number; humidity_pct: number; captured_at: string }; condition_alerts: string[] };
    expect(body.photo_conditions.temp_c).toBe(24);
    expect(body.photo_conditions.humidity_pct).toBe(55);
    expect(Number.isNaN(Date.parse(body.photo_conditions.captured_at))).toBe(false);
    expect(body.condition_alerts).toEqual([]);
  });

  it("passes through a supplied captured_at", async () => {
    const { env } = ctx();
    const capId = await makeCapture(env);
    const at = "2026-07-11T09:00:00Z";
    const res = await upload(env, capId, { temp_c: 20, captured_at: at });
    const body = (await res.json()) as { photo_conditions: { captured_at: string } };
    expect(body.photo_conditions.captured_at).toBe(at);
  });

  it("upload without photo_conditions still works (null conditions)", async () => {
    const { env } = ctx();
    const capId = await makeCapture(env);
    const res = await upload(env, capId);
    expect(res.status).toBe(202);
    expect(((await res.json()) as { photo_conditions: unknown }).photo_conditions).toBeNull();
  });
});

describe("OBS-28 threshold alert", () => {
  it("fires an alert when temperature/humidity cross the threshold", async () => {
    const { env } = ctx();
    const capId = await makeCapture(env);
    const res = await upload(env, capId, { temp_c: 41, humidity_pct: 92 });
    expect(res.status).toBe(202);
    const alerts = ((await res.json()) as { condition_alerts: string[] }).condition_alerts;
    expect(alerts).toContain("temp_c_high");
    expect(alerts).toContain("humidity_pct_high");
  });

  it("fires a low-side alert too", async () => {
    const { env } = ctx();
    const capId = await makeCapture(env);
    const res = await upload(env, capId, { temp_c: 2 });
    const alerts = ((await res.json()) as { condition_alerts: string[] }).condition_alerts;
    expect(alerts).toContain("temp_c_low");
  });
});

describe("OBS-28 placeholder / spoof rejection", () => {
  it("physically impossible humidity (>100%) → 400", async () => {
    const { env } = ctx();
    const capId = await makeCapture(env);
    const res = await upload(env, capId, { humidity_pct: 150 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("PHOTO_CONDITIONS_SPOOFED");
  });

  it("sentinel placeholder temperature (-999) → 400", async () => {
    const { env } = ctx();
    const capId = await makeCapture(env);
    const res = await upload(env, capId, { temp_c: -999 });
    expect(res.status).toBe(400);
  });

  it("epoch-0 captured_at placeholder → 400", async () => {
    const { env } = ctx();
    const capId = await makeCapture(env);
    const res = await upload(env, capId, { temp_c: 20, captured_at: "1970-01-01T00:00:00Z" });
    expect(res.status).toBe(400);
  });

  it("non-numeric temperature → 400", async () => {
    const { env } = ctx();
    const capId = await makeCapture(env);
    const res = await upload(env, capId, { temp_c: "hot" });
    expect(res.status).toBe(400);
  });
});
