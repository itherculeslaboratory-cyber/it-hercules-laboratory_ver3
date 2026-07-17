// CL-04: 71-route matrix ↔ deny-by-default 照合 (design-c2 §2).
// Reads tests/fixtures/route-matrix.csv and drives the real app:
//   (i) protected rows: unauthenticated → 401 AUTH_REQUIRED (gate before routing)
//   (ii) public rows: reachable without a session (never gate-blocked)
//   (iii) row count === 71. Lineage: base 68 (route-matrix.csv header comment) →
//        L-PAY レーン(round-16)が -6 GMO retired + 3 PAY.JP 新規 route(infra-route-
//        069..071: POST /fees/{obligation_id}/invoice・POST /fees/payjp-webhook
//        [PUBLIC]・GET /me/fees) = 65 → 認証レーン(round-16 OQ-ROUTE-01/V3-AUT-46)
//        統合マージが -2 onboarding rows(infra-route-006/010・未実装のまま廃止) +
//        1 verify-code 新規 route(infra-route-072・PUBLIC・V3-AUT-46)= 64 →
//        市場フォローレーン(round-15拡張 V3-GOV-35 違法出品ユーザー自治)が +6
//        route(infra-route-073..078・全 protected: POST .../flags・POST
//        .../gov-stop・GET .../flag-status ×2・GET .../misban-reversal・POST
//        .../misban-reversal/execute)= 70 → 知の広場レーン(round-16 OQ-PLZ-03)が
//        +1 route(infra-route-079: POST /plaza/threads/{thread_id}/resolution・
//        protected)= 71 → C8 g03知識レーン(V3-BBS-14)が +1 route(infra-route-080:
//        GET /plaza/channels/{channel}/improvement-queue・protected)= 72 → 同レーン
//        (V3-BBS-28)が +1 route(infra-route-081: GET /plaza/engagement/insights・
//        protected)= 73 → 同レーン(V3-PPR-07)が +1 route(infra-route-082: POST
//        /research/quadrant・protected)= 74 → 同レーン(V3-PPR-20)が +1 route
//        (infra-route-083: POST /research/auto-draft・protected)= 75。
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

describe("CL-04 route matrix (71 rows)", () => {
  it("has exactly 75 route rows", () => {
    expect(rows.length).toBe(75);
  });

  it("access column is only public|protected", () => {
    for (const r of rows) expect(["public", "protected"]).toContain(r.access);
  });

  it("public = only auth magic-link/verify/verify-code/session + payjp-webhook paths", () => {
    const publicPaths = new Set(rows.filter((r) => r.access === "public").map((r) => r.path));
    expect([...publicPaths].sort()).toEqual([
      "/api/v1/auth/magic-link",
      "/api/v1/auth/session",
      "/api/v1/auth/verify",
      "/api/v1/auth/verify-code",
      "/api/v1/fees/payjp-webhook",
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
