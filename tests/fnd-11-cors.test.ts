// FND-11 CORS TC (design-k7 §3). Drives the REAL app (apps/api/src/index) so the
// cors middleware + app.onError wiring is exercised end to end. credentials=true, so
// an allowed origin is echoed (never "*"). Covers: 200 carries ACAO+ACAC, a 401 gate
// response still carries CORS, a thrown 500 (broken TRUTH binding) is caught by
// onError and STILL carries CORS, OPTIONS preflight -> 204 + allow-methods/headers,
// and a non-allowed origin gets no ACAO. ASCII test names.
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { DEV_TOKEN, SESSION_SECRET, FakeR2Bucket } from "./helpers";

const ORIGIN = "https://app.example";
const EVIL = "https://evil.example";

function env(extra: Record<string, unknown> = {}) {
  return { DEV_TOKEN, SESSION_SECRET, CORS_ALLOW_ORIGINS: `${ORIGIN},https://other.example`, TRUTH: new FakeR2Bucket(), ...extra };
}

describe("FND-11 CORS all-response consistency", () => {
  it("200 to an allowed origin carries ACAO + ACAC", async () => {
    const res = await app.request("/health", { headers: { origin: ORIGIN } }, env());
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("401 AUTH_REQUIRED still carries CORS headers", async () => {
    const res = await app.request("/api/v1/placements", { headers: { origin: ORIGIN } }, env());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "AUTH_REQUIRED" });
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("a thrown 500 is caught by onError and STILL carries CORS headers", async () => {
    // A broken TRUTH binding whose list() rejects makes GET /placements throw after
    // the auth gate passes (DEV_TOKEN). The throw propagates to app.onError.
    const brokenBucket = { list: async () => { throw new Error("boom"); } };
    const res = await app.request(
      "/api/v1/placements",
      { headers: { origin: ORIGIN, authorization: `Bearer ${DEV_TOKEN}` } },
      env({ TRUTH: brokenBucket }),
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "INTERNAL" });
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("OPTIONS preflight returns 204 with allow-methods and allow-headers", async () => {
    const res = await app.request(
      "/api/v1/placements",
      { method: "OPTIONS", headers: { origin: ORIGIN, "access-control-request-method": "POST" } },
      env(),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("access-control-allow-methods")).toBe("GET,POST,OPTIONS");
    expect(res.headers.get("access-control-allow-headers")).toBe("Content-Type,Authorization");
    expect(res.headers.get("access-control-max-age")).toBe("86400");
  });

  it("a non-allowed origin gets no ACAO", async () => {
    const res = await app.request("/health", { headers: { origin: EVIL } }, env());
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
