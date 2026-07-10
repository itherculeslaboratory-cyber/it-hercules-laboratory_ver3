// C2 observation core TC (design-c2 §3). Drives the real app through the auth
// gate (DEV_TOKEN bearer). Covers captures/upload/detail/image/templates/
// individuals-observations/qr, plus the required negatives:
// 401 / bad domain 400 / duplicate 409 / V3-AUT-17 actor forge / V3-OBS-03 /
// QR resolve + expiry.
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, deriveActorId, ulid } from "@ihl/truth";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const JSON_HEADERS = { "content-type": "application/json" };
const AUTH = { Authorization: `Bearer ${DEV_TOKEN}` };
const AUTH_JSON = { ...AUTH, ...JSON_HEADERS };
const DEV_ACTOR = await deriveActorId("dev@ihl.local");

function ctx() {
  const bucket = new FakeR2Bucket();
  return { bucket, env: makeEnv(bucket) };
}

async function post(path: string, body: unknown, env: object, headers = AUTH_JSON) {
  return app.request(path, { method: "POST", headers, body: JSON.stringify(body) }, env);
}

describe("§3 captures", () => {
  it("appends a capture → 202 and stamps session actor_id (V3-AUT-17)", async () => {
    const { bucket, env } = ctx();
    // client tries to forge actor_id — must be ignored.
    const res = await post(
      "/api/v1/observation/captures",
      { domain: "biology", actor_id: "attacker", note: "n" },
      env,
    );
    expect(res.status).toBe(202);
    const { capture_id } = (await res.json()) as { capture_id: string };
    const stored = new TruthStore(bucket);
    const ev = await stored.readEvent(`truth/ihl.obs.capture.v1/${capture_id}.json`);
    expect((ev!.data as { actor_id: string }).actor_id).toBe(DEV_ACTOR);
  });

  it("unauthenticated capture → 401", async () => {
    const { env } = ctx();
    const res = await post("/api/v1/observation/captures", { domain: "biology" }, env, JSON_HEADERS);
    expect(res.status).toBe(401);
  });

  it("invalid domain → 400 (V3-OBS-01 5-domain enum)", async () => {
    const { env } = ctx();
    const res = await post("/api/v1/observation/captures", { domain: "aliens" }, env);
    expect(res.status).toBe(400);
  });

  it("same capture_id posted twice → 409 (append-only)", async () => {
    const { env } = ctx();
    const capture_id = ulid();
    const first = await post("/api/v1/observation/captures", { capture_id, domain: "mineral" }, env);
    expect(first.status).toBe(202);
    const dup = await post("/api/v1/observation/captures", { capture_id, domain: "mineral" }, env);
    expect(dup.status).toBe(409);
  });

  it("V3-OBS-03: species_confirmed_by != 'user' → 400", async () => {
    const { env } = ctx();
    const res = await post(
      "/api/v1/observation/captures",
      { domain: "biology", species_candidate: "Felis catus", species_confirmed_by: "ai" },
      env,
    );
    expect(res.status).toBe(400);
    const ok = await post(
      "/api/v1/observation/captures",
      { domain: "biology", species_candidate: "Felis catus", species_confirmed_by: "user" },
      env,
    );
    expect(ok.status).toBe(202);
  });
});

describe("§3 upload + detail + image", () => {
  async function makeCapture(env: object, extra: Record<string, unknown> = {}) {
    const res = await post("/api/v1/observation/captures", { domain: "biology", ...extra }, env);
    return ((await res.json()) as { capture_id: string }).capture_id;
  }

  it("upload → 202 with sha256; detail view returns capture + photo; image blob round-trips", async () => {
    const { env } = ctx();
    const captureId = await makeCapture(env);
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

    const fd = new FormData();
    fd.append("capture_id", captureId);
    fd.append("file", new Blob([bytes], { type: "image/png" }), "p.png");
    const up = await app.request(
      "/api/v1/observation/upload",
      { method: "POST", headers: AUTH, body: fd },
      env,
    );
    expect(up.status).toBe(202);
    const { photo_id, sha256 } = (await up.json()) as { photo_id: string; sha256: string };
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);

    const detail = await app.request(`/api/v1/observation/${captureId}`, { headers: AUTH }, env);
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as { capture: any; photos: any[] };
    expect(body.capture.capture_id).toBe(captureId);
    expect(body.photos).toHaveLength(1);
    expect(body.photos[0].photo_id).toBe(photo_id);

    const img = await app.request(
      `/api/v1/observation/${captureId}/image/${photo_id}`,
      { headers: AUTH },
      env,
    );
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(bytes);
  });

  it("detail view of unknown capture → 404", async () => {
    const { env } = ctx();
    const res = await app.request("/api/v1/observation/nope", { headers: AUTH }, env);
    expect(res.status).toBe(404);
  });

  it("photos of one capture do not leak into another (capture-prefix isolation)", async () => {
    const { env } = ctx();
    const a = await makeCapture(env);
    const b = await makeCapture(env);
    const fd = new FormData();
    fd.append("capture_id", a);
    fd.append("file", new Blob([new Uint8Array([9])], { type: "image/jpeg" }), "a.jpg");
    await app.request("/api/v1/observation/upload", { method: "POST", headers: AUTH, body: fd }, env);

    const detailB = await app.request(`/api/v1/observation/${b}`, { headers: AUTH }, env);
    expect(((await detailB.json()) as { photos: any[] }).photos).toHaveLength(0);
  });
});

describe("§3 templates (append + list projection agree)", () => {
  it("POST then GET returns the appended template (V3-OBS-18)", async () => {
    const { env } = ctx();
    const res = await post(
      "/api/v1/observation/templates",
      { title: "魚の計測", items: [{ label: "全長", kind: "number", unit: "mm" }] },
      env,
    );
    expect(res.status).toBe(202);
    const { template_id } = (await res.json()) as { template_id: string };

    const list = await app.request("/api/v1/observation/templates", { headers: AUTH }, env);
    const { templates } = (await list.json()) as { templates: { template_id: string; title: string }[] };
    expect(templates.map((t) => t.template_id)).toContain(template_id);
    expect(templates.find((t) => t.template_id === template_id)!.title).toBe("魚の計測");
  });

  it("template with an out-of-enum item kind → 400", async () => {
    const { env } = ctx();
    const res = await post(
      "/api/v1/observation/templates",
      { title: "x", items: [{ label: "l", kind: "hologram" }] },
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe("§3 individuals observations (subject_ref filter)", () => {
  it("returns only captures whose subject_ref matches (V3-IND-01)", async () => {
    const { env } = ctx();
    const indId = "ind-123";
    await post(
      "/api/v1/observation/captures",
      { domain: "biology", subject_ref: `individual/${indId}` },
      env,
    );
    await post("/api/v1/observation/captures", { domain: "biology" }, env); // no subject

    const res = await app.request(
      `/api/v1/individuals/${indId}/observations`,
      { headers: AUTH },
      env,
    );
    const body = (await res.json()) as { individual_id: string; observations: any[] };
    expect(body.individual_id).toBe(indId);
    expect(body.observations).toHaveLength(1);
    expect(body.observations[0].subject_ref).toBe(`individual/${indId}`);
  });
});

describe("§3 QR issue + resolve + expiry", () => {
  it("issue → resolve returns individual_id (observation re-entry)", async () => {
    const { env } = ctx();
    const issue = await post("/api/v1/individuals/ind-9/qr", {}, env);
    expect(issue.status).toBe(202);
    const { token } = (await issue.json()) as { token: string };
    expect(token.length).toBeGreaterThanOrEqual(20);

    const resolve = await app.request(`/api/v1/qr/${token}`, { headers: AUTH }, env);
    expect(resolve.status).toBe(200);
    expect((await resolve.json()) as { individual_id: string }).toEqual({ individual_id: "ind-9" });
  });

  it("expired QR → 410 on resolve", async () => {
    const { env } = ctx();
    const past = new Date(Date.now() - 60_000).toISOString();
    const issue = await post("/api/v1/individuals/ind-9/qr", { expires_at: past }, env);
    const { token } = (await issue.json()) as { token: string };
    const resolve = await app.request(`/api/v1/qr/${token}`, { headers: AUTH }, env);
    expect(resolve.status).toBe(410);
  });

  it("unknown token → 404", async () => {
    const { env } = ctx();
    const res = await app.request(
      `/api/v1/qr/${"z".repeat(43)}`,
      { headers: AUTH },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("QR issue is protected (401 without auth)", async () => {
    const { env } = ctx();
    const res = await post("/api/v1/individuals/ind-9/qr", {}, env, JSON_HEADERS);
    expect(res.status).toBe(401);
  });
});
