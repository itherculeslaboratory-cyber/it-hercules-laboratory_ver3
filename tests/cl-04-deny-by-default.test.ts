// CL-04: 認証境界 deny-by-default (振る舞い TC — schemas/frozen/README.md 担保先).
// Only PUBLIC_ROUTES (= /health) are reachable unauthenticated; every other
// path — including unknown routes — requires auth.
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { AUTH_HEADERS, makeEnv } from "./helpers";

describe("CL-04 deny-by-default", () => {
  it("/health stays public (200 without auth)", async () => {
    const res = await app.request("/health", {}, makeEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("unauthenticated POST /events → 401", async () => {
    const res = await app.request("/events", { method: "POST" }, makeEnv());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "AUTH_REQUIRED" });
  });

  it("wrong bearer token → 401", async () => {
    const res = await app.request(
      "/events",
      { method: "POST", headers: { Authorization: "Bearer wrong" } },
      makeEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("malformed Authorization header (no Bearer) → 401", async () => {
    const res = await app.request(
      "/events",
      { method: "POST", headers: { Authorization: "test-dev-token" } },
      makeEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("unknown routes are NOT silently public: 401 without auth", async () => {
    const res = await app.request("/definitely-not-a-route", {}, makeEnv());
    expect(res.status).toBe(401);
  });

  it("unknown routes with valid auth → 404 (auth gate first, then routing)", async () => {
    const res = await app.request(
      "/definitely-not-a-route",
      { headers: AUTH_HEADERS },
      makeEnv(),
    );
    expect(res.status).toBe(404);
  });
});
