import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware, requiresAuth } from "./middleware";

describe("requiresAuth — V3-AUT-12 protected-route guard (pure)", () => {
  it("exempts the login entry screens", () => {
    expect(requiresAuth("/s/login")).toBe(false);
    expect(requiresAuth("/s/login-sent")).toBe(false);
  });
  it("requires a session for every other screen, including home", () => {
    expect(requiresAuth("/")).toBe(true);
    expect(requiresAuth("/s/settings")).toBe(true);
    expect(requiresAuth("/qr/abc123")).toBe(true);
  });
});

describe("middleware — V3-AUT-12 redirect behavior", () => {
  it("lets an authenticated request through unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ authenticated: true, actor_id: "a" }), { status: 200 })),
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ authenticated: false }), { status: 200 })),
    );
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

  it("fails closed (redirects) when the API is unreachable", async () => {
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
});
