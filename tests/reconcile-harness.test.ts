// Phase C6 — reconcile-harness core logic (fixture-based, NO real network).
// A mock `fetch` is injected via opts.fetch; nothing here touches the wire.
import { describe, expect, it } from "vitest";
import {
  diffJson,
  matchesWhitelist,
  compareRoute,
  getRoutes,
  resolvePath,
  parseRouteMatrix,
  DEFAULT_WHITELIST,
} from "../scripts/reconcile-harness.mjs";

// A fetch that answers old-vs-new by base prefix with a given {status, body}.
function mockFetch(oldBase: string, map: Record<string, { status: number; body: unknown }>) {
  return async (url: string) => {
    const side = String(url).startsWith(oldBase) ? "old" : "new";
    const r = map[side];
    return { status: r.status, text: async () => JSON.stringify(r.body) } as Response;
  };
}
const OLD = "https://old.example";
const NEW = "https://new.example";
const route = { method: "GET", path: "/api/v1/x" };

describe("diffJson whitelist", () => {
  it("ignores envelope-variable fields (id/generated_at/*_at) — structurally equal", () => {
    const a = { id: "A1", generated_at: "2026-01-01", created_at: "x", value: 5 };
    const b = { id: "B9", generated_at: "2026-07-11", created_at: "y", value: 5 };
    expect(diffJson(a, b)).toEqual([]);
  });

  it("reports a real (non-whitelisted) field difference", () => {
    const d = diffJson({ id: "A", value: 5 }, { id: "B", value: 6 });
    expect(d).toEqual([{ path: "value", kind: "value", old: 5, new: 6 }]);
  });

  it("matchesWhitelist matches a leaf key and honours '*' wildcards", () => {
    expect(matchesWhitelist("data.updated_at", "updated_at", DEFAULT_WHITELIST)).toBe(true);
    expect(matchesWhitelist("data.value", "value", DEFAULT_WHITELIST)).toBe(false);
  });
});

describe("compareRoute (mock fetch)", () => {
  it("401 on both hosts → protected match (no body diff)", async () => {
    const fetch = mockFetch(OLD, {
      old: { status: 401, body: { error: "AUTH_REQUIRED" } },
      new: { status: 401, body: { error: "AUTH_REQUIRED" } },
    });
    const r = await compareRoute(OLD, NEW, route, { fetch });
    expect(r.verdict).toBe("match");
    expect(r.status_match).toBe(true);
    expect(r.body_diff).toEqual([]);
  });

  it("status mismatch (200 vs 500) → diff", async () => {
    const fetch = mockFetch(OLD, {
      old: { status: 200, body: { ok: true } },
      new: { status: 500, body: { ok: false } },
    });
    const r = await compareRoute(OLD, NEW, route, { fetch });
    expect(r.status_match).toBe(false);
    expect(r.verdict).toBe("diff");
  });

  it("200/200 with only whitelisted body drift → match", async () => {
    const fetch = mockFetch(OLD, {
      old: { status: 200, body: { id: "1", generated_at: "a", n: 3 } },
      new: { status: 200, body: { id: "2", generated_at: "b", n: 3 } },
    });
    const r = await compareRoute(OLD, NEW, route, { fetch });
    expect(r.verdict).toBe("match");
    expect(r.body_diff).toEqual([]);
  });

  it("200/200 with a real body difference → diff", async () => {
    const fetch = mockFetch(OLD, {
      old: { status: 200, body: { n: 3 } },
      new: { status: 200, body: { n: 4 } },
    });
    const r = await compareRoute(OLD, NEW, route, { fetch });
    expect(r.verdict).toBe("diff");
    expect(r.body_diff).toEqual([{ path: "n", kind: "value", old: 3, new: 4 }]);
  });

  it("404 on old but present on new → new-only; refuses non-GET routes", async () => {
    const fetch = mockFetch(OLD, {
      old: { status: 404, body: { error: "NOT_FOUND" } },
      new: { status: 200, body: { ok: true } },
    });
    const r = await compareRoute(OLD, NEW, route, { fetch });
    expect(r.verdict).toBe("new-only");

    const bad = await compareRoute(OLD, NEW, { method: "POST", path: "/x" }, { fetch });
    expect(bad.verdict).toBe("error");
  });
});

describe("route extraction is GET-only and param-safe", () => {
  const csv = parseRouteMatrix(
    "feature,method,path\n—,GET,/api/v1/a\n—,POST,/api/v1/b\n—,GET,/api/v1/obs/{capture_id}\n",
  );

  it("drops POST/PATCH rows (no mutating call is ever possible)", () => {
    const gets = getRoutes(csv);
    expect(gets.map((r) => r.path)).toEqual(["/api/v1/a", "/api/v1/obs/{capture_id}"]);
    expect(gets.some((r) => r.method !== "GET")).toBe(false);
  });

  it("skips a route whose {param} is unfilled, substitutes when provided", () => {
    expect(resolvePath("/api/v1/obs/{capture_id}").resolved).toBeNull();
    expect(resolvePath("/api/v1/obs/{capture_id}", { capture_id: "abc" }).resolved).toBe(
      "/api/v1/obs/abc",
    );
  });
});
