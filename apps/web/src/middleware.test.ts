import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware, requiresAuth, skipsOnboardingCheck } from "./middleware";

describe("requiresAuth — V3-AUT-12 protected-route guard (pure)", () => {
  it("exempts the login entry screens", () => {
    expect(requiresAuth("/s/login")).toBe(false);
    expect(requiresAuth("/s/login-sent")).toBe(false);
  });
  it("requires a session for every other screen, including home and setup-profile", () => {
    expect(requiresAuth("/")).toBe(true);
    expect(requiresAuth("/s/settings")).toBe(true);
    expect(requiresAuth("/qr/abc123")).toBe(true);
    expect(requiresAuth("/s/setup-profile")).toBe(true); // still needs a SESSION, just not onboarding
  });
});

describe("skipsOnboardingCheck — V3-AUT-10 onboarding gate (pure)", () => {
  it("skips the login screens (they never reach the onboarding check anyway) and setup-profile itself", () => {
    expect(skipsOnboardingCheck("/s/login")).toBe(true);
    expect(skipsOnboardingCheck("/s/login-sent")).toBe(true);
    expect(skipsOnboardingCheck("/s/setup-profile")).toBe(true);
  });
  it("checks every other screen", () => {
    expect(skipsOnboardingCheck("/")).toBe(false);
    expect(skipsOnboardingCheck("/s/settings")).toBe(false);
  });
});

function mockFetchSequence(responses: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [path, body] of Object.entries(responses)) {
      if (url.includes(path)) return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 404 });
  });
}

describe("middleware — V3-AUT-12 redirect behavior", () => {
  it("lets an authenticated + onboarded request through unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchSequence({
        "/auth/session": { authenticated: true, actor_id: "a", onboarding_complete: true },
      }),
    );
    try {
      const req = new NextRequest("http://localhost:3000/s/settings", { headers: { cookie: "ihl_session=v1.x.y" } });
      const res = await middleware(req);
      expect(res.status).toBe(200); // NextResponse.next() default
      expect(res.headers.get("location")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("redirects an unauthenticated request to /s/login with 307", async () => {
    vi.stubGlobal("fetch", mockFetchSequence({ "/auth/session": { authenticated: false } }));
    try {
      const req = new NextRequest("http://localhost:3000/s/settings");
      const res = await middleware(req);
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/s/login");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("skips the check entirely for /s/login (no fetch call)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const req = new NextRequest("http://localhost:3000/s/login");
      const res = await middleware(req);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(res.headers.get("location")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails closed (redirects to /s/login) when the API is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    try {
      const req = new NextRequest("http://localhost:3000/");
      const res = await middleware(req);
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/s/login");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // ── V3-AUT-10 onboarding gate ────────────────────────────────────────────
  // SSOT: onboarding_complete comes from GET /auth/session (apps/api
  // projectOnboardingStatus — handle + explicit-locale gates), not a
  // separately-derived /me/preferences check.
  it("redirects a logged-in visitor with onboarding_complete:false to /s/setup-profile", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchSequence({
        "/auth/session": { authenticated: true, actor_id: "a", onboarding_complete: false },
      }),
    );
    try {
      const req = new NextRequest("http://localhost:3000/", { headers: { cookie: "ihl_session=v1.x.y" } });
      const res = await middleware(req);
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/s/setup-profile");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does NOT redirect-loop: /s/setup-profile itself is reachable even with onboarding_complete:false", async () => {
    const fetchMock = mockFetchSequence({
      "/auth/session": { authenticated: true, actor_id: "a", onboarding_complete: false },
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const req = new NextRequest("http://localhost:3000/s/setup-profile", { headers: { cookie: "ihl_session=v1.x.y" } });
      const res = await middleware(req);
      expect(res.headers.get("location")).toBeNull();
      // exactly one call: the single /auth/session fetch covers both gates.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails OPEN on the onboarding gate alone when the field is missing/malformed (session itself is confirmed authenticated)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchSequence({ "/auth/session": { authenticated: true, actor_id: "a" } }), // no onboarding_complete field
    );
    try {
      const req = new NextRequest("http://localhost:3000/", { headers: { cookie: "ihl_session=v1.x.y" } });
      const res = await middleware(req);
      // a confirmed real session is never trapped by a missing/malformed field
      expect(res.headers.get("location")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
