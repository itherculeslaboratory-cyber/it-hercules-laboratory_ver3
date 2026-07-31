// V3-FND-22 S1: response-envelope-middleware.ts の allowlist ゲートを守るガードテスト。
// 設計正本 = 00-hq\proposals\R0801-41f081-DESIGN-2026-08-01-g66-envdesign.md §4-S1-4。
// index.ts は不可侵・未mountのため、ここでは自前の小さな Hono app に middleware を
// 直接マウントして検証する(index.ts の実 app には一切触れない)。
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { ENVELOPE_ROUTES, responseEnvelope } from "../apps/api/src/response-envelope-middleware";

describe("① ENVELOPE_ROUTES の全キーが実app.routesに実在する(drift検知)", () => {
  it("現状(空Set)は自明に通る", () => {
    const realKeys = new Set(app.routes.map((r) => `${r.method} ${r.path}`));
    for (const key of ENVELOPE_ROUTES) {
      expect(realKeys.has(key)).toBe(true);
    }
  });

  it("route名変更で存在しなくなったキーはdrift検知ロジックで検出される", () => {
    const realKeys = new Set(app.routes.map((r) => `${r.method} ${r.path}`));
    expect(realKeys.has("GET /api/v1/no-such-route-ever")).toBe(false);
  });
});

function buildTestApp() {
  const testApp = new Hono();
  testApp.use("*", responseEnvelope());
  testApp.get("/registered", (c) => c.json({ hello: "world" }));
  testApp.get("/unregistered", (c) => c.json({ hello: "world" }));
  testApp.get("/error-route", (c) => c.json({ error: "SOME_ERROR", detail: "x" }, 400));
  return testApp;
}

describe("② 未登録routeは包まれない(inert回帰防止)", () => {
  it("ENVELOPE_ROUTES に無いrouteはそのままの応答形状", async () => {
    ENVELOPE_ROUTES.clear();
    const testApp = buildTestApp();
    const res = await testApp.request("/unregistered");
    expect(await res.json()).toEqual({ hello: "world" });
  });
});

describe("③ 登録routeは包まれる", () => {
  it("ENVELOPE_ROUTES に載っているrouteは data/meta へ包まれる", async () => {
    ENVELOPE_ROUTES.clear();
    ENVELOPE_ROUTES.add("GET /registered");
    try {
      const testApp = buildTestApp();
      const res = await testApp.request("/registered");
      const body = await res.json();
      expect(body).toMatchObject({ data: { hello: "world" } });
      expect(body.meta).toMatchObject({ requestId: expect.any(String), timestamp: expect.any(String) });
    } finally {
      ENVELOPE_ROUTES.clear();
    }
  });

  it("エラー側は兄弟フィールドを保ったまま meta が増える(§2-1修正の確認)", async () => {
    ENVELOPE_ROUTES.clear();
    ENVELOPE_ROUTES.add("GET /error-route");
    try {
      const testApp = buildTestApp();
      const res = await testApp.request("/error-route");
      const body = await res.json();
      expect(body).toMatchObject({ error: "SOME_ERROR", detail: "x" });
      expect(body.meta).toMatchObject({ requestId: expect.any(String), timestamp: expect.any(String) });
    } finally {
      ENVELOPE_ROUTES.clear();
    }
  });
});

describe("④ content-length があるなら本体長と一致する(設計§6-5)", () => {
  it("包んだ応答の content-length は実際のbody長と一致(または未設定)", async () => {
    ENVELOPE_ROUTES.clear();
    ENVELOPE_ROUTES.add("GET /registered");
    try {
      const testApp = buildTestApp();
      const res = await testApp.request("/registered");
      const text = await res.clone().text();
      const cl = res.headers.get("content-length");
      if (cl !== null) {
        expect(Number(cl)).toBe(new TextEncoder().encode(text).length);
      }
    } finally {
      ENVELOPE_ROUTES.clear();
    }
  });
});
