// CL-04: 57-route matrix ↔ deny-by-default 照合 (design-c2 §2).
// Reads tests/fixtures/route-matrix.csv and drives the real app:
//   (i) protected rows: unauthenticated → 401 AUTH_REQUIRED (gate before routing)
//   (ii) public rows: reachable without a session (never gate-blocked)
//   (iii) row count === 57
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { SESSION_SECRET, makeEnv } from "./helpers";
import { issueMagicToken } from "../apps/api/src/session";

type Row = { method: string; path: string; access: string };

function loadMatrix(): Row[] {
  const url = new URL("./fixtures/route-matrix.csv", import.meta.url);
  const lines = readFileSync(url, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "" && !l.startsWith("#"));
  const header = lines[0].split(",");
  const iMethod = header.indexOf("method");
  const iPath = header.indexOf("path");
  const iAccess = header.indexOf("access");
  return lines.slice(1).map((l) => {
    const cols = l.split(",");
    return { method: cols[iMethod], path: cols[iPath], access: cols[iAccess] };
  });
}

// {param} → dummy value so the path is requestable.
function concretePath(p: string): string {
  return p.replace(/\{[^}]+\}/g, "x");
}

const rows = loadMatrix();

describe("CL-04 route matrix (57 rows)", () => {
  it("has exactly 57 route rows", () => {
    expect(rows.length).toBe(57);
  });

  it("access column is only public|protected", () => {
    for (const r of rows) expect(["public", "protected"]).toContain(r.access);
  });

  it("public = only auth magic-link/verify/session paths", () => {
    const publicPaths = new Set(rows.filter((r) => r.access === "public").map((r) => r.path));
    expect([...publicPaths].sort()).toEqual([
      "/api/v1/auth/magic-link",
      "/api/v1/auth/session",
      "/api/v1/auth/verify",
    ]);
  });

  it("every protected row → 401 AUTH_REQUIRED without auth", async () => {
    for (const r of rows.filter((x) => x.access === "protected")) {
      const res = await app.request(
        concretePath(r.path),
        { method: r.method },
        makeEnv(),
      );
      expect(res.status, `${r.method} ${r.path}`).toBe(401);
      expect(await res.json()).toEqual({ error: "AUTH_REQUIRED" });
    }
  });

  it("every public row is reachable without a session (not 401)", async () => {
    for (const r of rows.filter((x) => x.access === "public")) {
      // Provide minimal valid input so the route's own validation doesn't 401.
      let init: RequestInit = { method: r.method };
      if (r.path.endsWith("/magic-link")) {
        init = {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "matrix@example.com" }),
        };
      } else if (r.path.endsWith("/verify")) {
        const tok = await issueMagicToken("matrix@example.com", SESSION_SECRET);
        init = {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: tok }),
        };
      }
      const res = await app.request(concretePath(r.path), init, makeEnv());
      expect(res.status, `${r.method} ${r.path}`).not.toBe(401);
    }
  });
});
