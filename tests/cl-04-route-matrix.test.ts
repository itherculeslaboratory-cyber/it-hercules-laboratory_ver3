// CL-04: 93-route matrix ↔ deny-by-default 照合 (design-c2 §2).
// Reads tests/fixtures/route-matrix.csv and drives the real app:
//   (i) protected rows: unauthenticated → 401 AUTH_REQUIRED (gate before routing)
//   (ii) public rows: reachable without a session (never gate-blocked)
//   (iii) row count === 93. Lineage: base 68 (route-matrix.csv header comment) →
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
//        protected)= 71 → g01-基盤コストレーン(V3-CST-02)が +1 route
//        (infra-route-080: GET /costs・protected)= 72 → V3-AIP-67(GitHub
//        Issues/掲示板→AI要約スレ)が新規 1 route(infra-route-081: POST
//        /ai-digest/sync・protected・requireRole operator/admin)= 73 →
//        g04-経済レーン(V3-MKT-35)が +1 route(infra-route-082: POST
//        /economy/vote・protected)= 74 → g02-観測レーン(C8 obs-analysis・
//        V3-OBS-57)が +1 route(infra-route-083: GET /observation/{capture_id}/
//        species-suggestions・protected)= 75 → obs-capture レーン(V3-OBS-20
//        棚/場所QR)が +1 route(infra-route-084: POST /placements/
//        {placement_id}/qr・protected)= 76 → obs-capture レーン(V3-OBS-72
//        研究室環境コンテキスト)が +3 route(infra-route-085..087: POST/GET
//        .../lab-environment・GET individuals/{id}/lab-environment・全
//        protected)= 79 → obs-capture レーン(V3-OBS-61 自然言語フリーテキスト
//        解析)が +1 route(infra-route-088: POST /observation/parse-freetext・
//        protected)= 80 → 観測個体レーン(C8 obs-individuals)が +1 route(infra-route-
//        089: GET /match/convergence・protected)= 81 → 同レーンが +1 route(infra-route-
//        090: GET /individuals/lineage-check・protected)= 82 → g07-UIUXレーン
//        (V3-UIX-26)が +1 route(infra-route-091: GET /home/civ-minimap・
//        protected・080は先に基盤コストレーンが採ったため採番をずらして解決)= 83 →
//        C8 g03知識レーン(V3-BBS-14)が +1 route(infra-route-092: GET
//        /plaza/channels/{channel}/improvement-queue・protected・080-091は先に
//        他レーンが採ったため092から採番)= 84 → 同レーン(V3-BBS-28)が +1 route
//        (infra-route-093: GET /plaza/engagement/insights・protected)= 85 → 同レーン
//        (V3-PPR-07)が +1 route(infra-route-094: POST /research/quadrant・
//        protected)= 86 → 同レーン(V3-PPR-20)が +1 route(infra-route-095: POST
//        /research/auto-draft・protected)= 87 → 同レーン(V3-PPR-23)が +1 route
//        (infra-route-096: GET /research/content/{id}/export・protected)= 88 →
//        同レーン(V3-PPR-12)が +1 route(infra-route-097: GET /observation/export・
//        protected。reanalyze バッチは既存 batch-commit 拡張のため新規 route 無し)= 89 →
//        同レーン(V3-WIK-20)が +1 route(infra-route-098: GET /knowledge/cell/{id}・
//        protected)= 90 → 同レーン(V3-WIK-07)が +2 route(infra-route-099: POST
//        /wiki/lint・infra-route-100: GET /wiki/lint-log・共に protected)= 92 →
//        同レーン(V3-WIK-29)が +1 route(infra-route-101: POST
//        /research/external-import・protected)= 93。
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

describe("CL-04 route matrix (93 rows)", () => {
  it("has exactly 93 route rows", () => {
    expect(rows.length).toBe(93);
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
