// PAY.JP Checkout v2(外部リンク型決済・test-mode)TC。payjp-checkout-routes.ts は index.ts
// 不可侵ルールにより未 mount のため(mount すべき行は報告書に逐語で提示・HQ が適用)、
// fee-routes.test.ts と同じ DI パターンで、この route だけを最小 Hono へ独立 mount して
// fake connector 越しに検証する。カード番号・CVC・有効期限に相当する文字列はこのファイルの
// どこにも書かない(方式B=外部リンク型のためカード情報自体を自社が扱わない)。
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { TruthStore, deriveActorId, ulid } from "@ihl/truth";
import { OBLIGATION_TYPE } from "../apps/api/src/gmo-routes";
import { createPayjpCheckoutRoutes } from "../apps/api/src/payjp-checkout-routes";
import { makePayjpConnector } from "../apps/api/src/payjp-connector";
import type { PayjpCheckoutSession, PayjpConnector, CreateCheckoutSessionParams } from "../apps/api/src/payjp-connector";
import type { Bindings, Variables } from "../apps/api/src/env";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const JSON_HEADERS = { "content-type": "application/json" };
const AUTH_HEADERS = { Authorization: `Bearer ${DEV_TOKEN}`, ...JSON_HEADERS };
const DEV_ACTOR = await deriveActorId("dev@ihl.local");

async function seedObligation(
  s: TruthStore,
  opts: { actorId?: string; amount?: number } = {},
): Promise<string> {
  const id = ulid();
  const res = await s.putEvent({
    specversion: "1.0",
    id,
    source: "apps/api",
    type: OBLIGATION_TYPE,
    time: new Date().toISOString(),
    dataschema: "schemas/events/gmo-obligation.schema.json",
    provenance: { generator_kind: "agent", agent_name: "test" },
    data: {
      obligation_id: id,
      actor_id: opts.actorId ?? DEV_ACTOR,
      transfer_code: "U-TEST1",
      amount: opts.amount ?? 500,
      obligation_kind: "fee_tax",
      due_date: "2026-07-01T00:00:00Z",
      created_at: new Date().toISOString(),
      schema_version: "1",
    },
  });
  if (res.status !== "inserted") throw new Error(`seed obligation failed: ${res.status}`);
  return id;
}

// index.ts の DEV_TOKEN 経路だけを再現した最小 auth ミドルウェア(index.ts 本体は複製不能な
// 単一 default export のため、mkt-62 旧テストと同じ最小移植パターンを踏襲)。
function mountWithFakeConnector(opts: {
  session?: PayjpCheckoutSession;
  fail?: boolean;
} = {}) {
  const fake: PayjpConnector = {
    mode: "fake",
    async getCharge() {
      return null;
    },
    async createTenant() {
      throw new Error("not used in this TC");
    },
    async createPlatformCharge() {
      throw new Error("not used in this TC");
    },
    async createCheckoutSession(params: CreateCheckoutSessionParams) {
      if (opts.fail) throw new Error("payjp checkout sessions HTTP 502");
      return (
        opts.session ?? {
          id: "cs_test_1",
          url: "https://checkout.pay.jp/cs_test_1",
          status: "open",
          metadata: params.metadata,
        }
      );
    },
  };
  const test = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  test.use("*", async (c, next) => {
    // index.ts の PUBLIC_ROUTES 相当(このファイルの webhook route だけは未認証を許す)。
    if (c.req.path === "/api/v1/fees/payjp-checkout-webhook") return next();
    const header = c.req.header("Authorization") ?? "";
    const bearerTok = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (bearerTok && c.env?.DEV_TOKEN && bearerTok === c.env.DEV_TOKEN) {
      c.set("actorId", DEV_ACTOR);
      c.set("roles", []);
      return next();
    }
    return c.json({ error: "AUTH_REQUIRED" }, 401);
  });
  test.route("/api/v1", createPayjpCheckoutRoutes(() => fake));
  return test;
}

describe("POST /api/v1/fees/{obligation_id}/checkout-session(本人スコープ・カード情報は扱わない)", () => {
  it("認証なし → 401", async () => {
    const test = mountWithFakeConnector();
    const res = await test.request("/api/v1/fees/x/checkout-session", { method: "POST", headers: JSON_HEADERS }, makeEnv());
    expect(res.status).toBe(401);
  });

  it("義務が存在しない → 404", async () => {
    const test = mountWithFakeConnector();
    const res = await test.request("/api/v1/fees/OBL-GHOST/checkout-session", { method: "POST", headers: AUTH_HEADERS }, makeEnv());
    expect(res.status).toBe(404);
  });

  it("他人の義務 → 403", async () => {
    const bucket = new FakeR2Bucket();
    const obligationId = await seedObligation(new TruthStore(bucket), { actorId: "someone-else" });
    const test = mountWithFakeConnector();
    const res = await test.request(`/api/v1/fees/${obligationId}/checkout-session`, { method: "POST", headers: AUTH_HEADERS }, makeEnv(bucket));
    expect(res.status).toBe(403);
  });

  it("本人の義務 → 201・checkout_url を返す(obligation.amount がそのまま渡る・二重5%適用なし)", async () => {
    const bucket = new FakeR2Bucket();
    const obligationId = await seedObligation(new TruthStore(bucket), { amount: 500 });
    let seenAmount: number | undefined;
    // fake connector 越しに amount を検査できるよう、専用の connector を直接注入する。
    const test = new Hono<{ Bindings: Bindings; Variables: Variables }>();
    test.use("*", async (c, next) => {
      const header = c.req.header("Authorization") ?? "";
      const tok = header.startsWith("Bearer ") ? header.slice(7) : "";
      if (tok && c.env?.DEV_TOKEN && tok === c.env.DEV_TOKEN) {
        c.set("actorId", DEV_ACTOR);
        c.set("roles", []);
        return next();
      }
      return c.json({ error: "AUTH_REQUIRED" }, 401);
    });
    test.route(
      "/api/v1",
      createPayjpCheckoutRoutes(() => ({
        mode: "fake",
        async getCharge() {
          return null;
        },
        async createTenant() {
          throw new Error("not used");
        },
        async createPlatformCharge() {
          throw new Error("not used");
        },
        async createCheckoutSession(params) {
          seenAmount = params.amount;
          return { id: "cs_test_2", url: "https://checkout.pay.jp/cs_test_2", status: "open", metadata: params.metadata };
        },
      })),
    );
    const res = await test.request(`/api/v1/fees/${obligationId}/checkout-session`, { method: "POST", headers: AUTH_HEADERS }, makeEnv(bucket));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ checkout_url: "https://checkout.pay.jp/cs_test_2", session_id: "cs_test_2" });
    expect(seenAmount).toBe(500); // 500 のまま(0.05 を再度掛けていない)
  });

  it("connector が失敗 → 502", async () => {
    const bucket = new FakeR2Bucket();
    const obligationId = await seedObligation(new TruthStore(bucket), { amount: 500 });
    const test = mountWithFakeConnector({ fail: true });
    const res = await test.request(`/api/v1/fees/${obligationId}/checkout-session`, { method: "POST", headers: AUTH_HEADERS }, makeEnv(bucket));
    expect(res.status).toBe(502);
  });
});

describe("POST /api/v1/fees/payjp-checkout-webhook(PUBLIC・X-Payjp-Webhook-Token 検証)", () => {
  function webhookEnv(bucket: FakeR2Bucket, token = "whook_test_1") {
    return { ...makeEnv(bucket), PAYJP_WEBHOOK_TOKEN: token };
  }

  it("token ヘッダ欠如 → 401", async () => {
    const test = mountWithFakeConnector();
    const res = await test.request(
      "/api/v1/fees/payjp-checkout-webhook",
      { method: "POST", headers: JSON_HEADERS, body: "{}" },
      webhookEnv(new FakeR2Bucket()),
    );
    expect(res.status).toBe(401);
  });

  it("token 不一致 → 401", async () => {
    const test = mountWithFakeConnector();
    const res = await test.request(
      "/api/v1/fees/payjp-checkout-webhook",
      { method: "POST", headers: { ...JSON_HEADERS, "X-Payjp-Webhook-Token": "wrong" }, body: "{}" },
      webhookEnv(new FakeR2Bucket()),
    );
    expect(res.status).toBe(401);
  });

  it("token 一致・type=checkout.session.completed・obligation実在 → 201・settlement記録", async () => {
    const bucket = new FakeR2Bucket();
    const obligationId = await seedObligation(new TruthStore(bucket), { amount: 500 });
    const test = mountWithFakeConnector();
    const body = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { id: "cs_ok_1", metadata: { obligation_id: obligationId } } },
    });
    const res = await test.request(
      "/api/v1/fees/payjp-checkout-webhook",
      { method: "POST", headers: { ...JSON_HEADERS, "X-Payjp-Webhook-Token": "whook_test_1" }, body },
      webhookEnv(bucket),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ok: true, obligation_id: obligationId });
  });

  it("同一 session の再送 → 200 duplicate(冪等)", async () => {
    const bucket = new FakeR2Bucket();
    const obligationId = await seedObligation(new TruthStore(bucket), { amount: 500 });
    const test = mountWithFakeConnector();
    const body = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { id: "cs_ok_2", metadata: { obligation_id: obligationId } } },
    });
    const headers = { ...JSON_HEADERS, "X-Payjp-Webhook-Token": "whook_test_1" };
    const first = await test.request("/api/v1/fees/payjp-checkout-webhook", { method: "POST", headers, body }, webhookEnv(bucket));
    expect(first.status).toBe(201);
    const second = await test.request("/api/v1/fees/payjp-checkout-webhook", { method: "POST", headers, body }, webhookEnv(bucket));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ ok: true, duplicate: true });
  });

  it("type が checkout.session.completed 以外 → 202・記録しない", async () => {
    const test = mountWithFakeConnector();
    const body = JSON.stringify({ type: "checkout.session.expired", data: { object: { id: "cs_exp_1" } } });
    const res = await test.request(
      "/api/v1/fees/payjp-checkout-webhook",
      { method: "POST", headers: { ...JSON_HEADERS, "X-Payjp-Webhook-Token": "whook_test_1" }, body },
      webhookEnv(new FakeR2Bucket()),
    );
    expect(res.status).toBe(202);
  });

  it("metadata.obligation_id 欠如 → 400", async () => {
    const test = mountWithFakeConnector();
    const body = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_no_meta" } } });
    const res = await test.request(
      "/api/v1/fees/payjp-checkout-webhook",
      { method: "POST", headers: { ...JSON_HEADERS, "X-Payjp-Webhook-Token": "whook_test_1" }, body },
      webhookEnv(new FakeR2Bucket()),
    );
    expect(res.status).toBe(400);
  });

  it("obligation_id が義務台帳に存在しない → 404", async () => {
    const test = mountWithFakeConnector();
    const body = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { id: "cs_ghost", metadata: { obligation_id: "OBL-GHOST" } } },
    });
    const res = await test.request(
      "/api/v1/fees/payjp-checkout-webhook",
      { method: "POST", headers: { ...JSON_HEADERS, "X-Payjp-Webhook-Token": "whook_test_1" }, body },
      webhookEnv(new FakeR2Bucket()),
    );
    expect(res.status).toBe(404);
  });
});

describe("PAYJP_MODE=live は createCheckoutSession も人間ゲートまで明示 throw", () => {
  it("live connector.createCheckoutSession は throw する", async () => {
    const c = makePayjpConnector({ PAYJP_MODE: "live" });
    expect(c.mode).toBe("live");
    await expect(
      c.createCheckoutSession({
        amount: 500,
        productName: "test",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
        metadata: {},
      }),
    ).rejects.toThrow(/live connector not implemented/);
  });
});
