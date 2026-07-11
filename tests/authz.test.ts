// C5 K2 ロール機構 TC (design-c5-k2 §1.4 / V3-AUT-22・機構のみ).
// requireRole の許可/拒否(taxonomy 非依存)、roles claim のトークン往復(非空のみ
// 載る=後方互換)、roles を帯びた/DEV_TOKEN セッションが既存保護 route を壊さない配線。
// admin route への attach + Capability チャネルは統一ロール裁定まで保留(本波非対象)。
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import app from "../apps/api/src/index";
import { requireRole } from "../apps/api/src/authz";
import { issueSessionToken, verifySessionToken } from "../apps/api/src/session";
import type { Variables } from "../apps/api/src/env";
import { DEV_TOKEN, SESSION_SECRET, makeEnv } from "./helpers";

// roles を固定 set した最小アプリで requireRole を素の中間層として検証する。
function appWithRoles(roles: string[], ...allowed: string[]) {
  const a = new Hono<{ Variables: Variables }>();
  a.use("*", async (c, next) => {
    c.set("roles", roles);
    return next();
  });
  a.get("/guarded", requireRole(...allowed), (c) => c.json({ ok: true }));
  return a;
}

describe("V3-AUT-22 requireRole(機構・taxonomy 非依存)", () => {
  it("allowed ロール無し → 403 FORBIDDEN", async () => {
    const res = await appWithRoles([], "admin").request("/guarded");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "FORBIDDEN" });
  });

  it("allowed ロール有り → 通過(200)", async () => {
    const res = await appWithRoles(["admin"], "admin").request("/guarded");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("複数 allowed のいずれかを持てば通過(任意ロール文字列)", async () => {
    const res = await appWithRoles(["editor"], "admin", "editor").request("/guarded");
    expect(res.status).toBe(200);
  });

  it("DEV_TOKEN 相当(roles=[])は admin ゲートで 403", async () => {
    const res = await appWithRoles([], "admin").request("/guarded");
    expect(res.status).toBe(403);
  });
});

describe("V3-AUT-22 roles claim トークン往復(後方互換)", () => {
  it("issueSessionToken(...,roles) → verifySessionToken で roles が往復する", async () => {
    const tok = await issueSessionToken("actor-1", SESSION_SECRET, ["admin", "editor"]);
    const p = await verifySessionToken(tok, SESSION_SECRET);
    expect(p?.roles).toEqual(["admin", "editor"]);
  });

  it("roles 未指定なら claim を載せない(既存 auth-routes 呼び出し無改修)", async () => {
    const tok = await issueSessionToken("actor-1", SESSION_SECRET);
    const p = await verifySessionToken(tok, SESSION_SECRET);
    expect(p?.roles).toBeUndefined();
  });
});

describe("V3-AUT-22 roles 配線が既存保護 route を壊さない", () => {
  it("roles を帯びたセッション token でも保護 route は 200(roles は非破壊で運ばれる)", async () => {
    const tok = await issueSessionToken("actor-x", SESSION_SECRET, ["admin"]);
    const res = await app.request(
      "/api/v1/me/ledger",
      { headers: { Authorization: `Bearer ${tok}` } },
      makeEnv(),
    );
    expect(res.status).toBe(200);
  });

  it("DEV_TOKEN セッションも保護 route は 200(roles=[] で配線)", async () => {
    const res = await app.request(
      "/api/v1/me/ledger",
      { headers: { Authorization: `Bearer ${DEV_TOKEN}` } },
      makeEnv(),
    );
    expect(res.status).toBe(200);
  });
});
