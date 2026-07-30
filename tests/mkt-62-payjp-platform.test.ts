// V3-MKT-62/63(round-16裁定・P2P決済ユーザー選択制+PAY.JP Platform 5%自動控除)
// test-mode 結線 TC(fee-routes.ts: POST /market/payjp/tenant・
// POST /market/listings/{id}/payjp-charge)。fake connector DI シームで実 PAY.JP fetch
// なしに検証する(market-fee-obligation.test.ts / fee-routes.test.ts と同じパターン)。
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { ulid } from "@ihl/truth";
import app from "../apps/api/src/index";
import { issueSessionToken, verifySessionToken } from "../apps/api/src/session";
import { createFeeRoutes } from "../apps/api/src/fee-routes";
import { marketRoutes } from "../apps/api/src/market-routes";
import type { PayjpConnector, PayjpPlatformCharge, PayjpTenant } from "../apps/api/src/payjp-connector";
import type { Bindings, Variables } from "../apps/api/src/env";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function transition(env: object, headers: Record<string, string>, id: string, body: unknown) {
  return app.request(`/api/v1/market/listings/${id}/transition`, { method: "POST", headers, body: JSON.stringify(body) }, env);
}
function createListing(env: object, headers: Record<string, string>, listingId: string, price?: number) {
  const body: Record<string, unknown> = { listing_id: listingId, title: `listing ${listingId}` };
  if (price !== undefined) body.price = price;
  return app.request("/api/v1/market/listings", { method: "POST", headers, body: JSON.stringify(body) }, env);
}

// fake connector を DI シームへ注入し、実 PAY.JP fetch なしで tenant/platform charge を検証。
function mountWithFakeConnector(opts: { tenant?: PayjpTenant; charge?: PayjpPlatformCharge; failCharge?: boolean } = {}) {
  const fake: PayjpConnector = {
    mode: "fake",
    async getCharge() {
      return null;
    },
    async createTenant() {
      return opts.tenant ?? { id: "ten_x", name: "seller" };
    },
    async createPlatformCharge() {
      if (opts.failCharge) throw new Error("payjp charges HTTP 402");
      return (
        opts.charge ?? {
          id: "ch_platform_1",
          amount: 1000,
          currency: "jpy",
          paid: true,
          captured: true,
          metadata: {},
          tenant: "ten_x",
          platform_fee: 50,
        }
      );
    },
  };
  const test = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  // 最小 auth ミドルウェア(index.ts の Authorization: Bearer <v1. session token> 経路のみ
  // 再現・DEV_TOKEN/Cookie 経路は本 TC で不要)。actorId 保護ルートを fake connector 越しに
  // 検証するための最小移植(index.ts 本体は差し替え不能な単一 default export のため複製)。
  test.use("*", async (c, next) => {
    const header = c.req.header("Authorization") ?? "";
    const bearerTok = header.startsWith("Bearer ") ? header.slice(7) : "";
    const secret = (c.env as { SESSION_SECRET?: string })?.SESSION_SECRET;
    if (bearerTok && secret) {
      const p = await verifySessionToken(bearerTok, secret);
      if (p) {
        c.set("actorId", p.sub);
        c.set("roles", []);
        return next();
      }
    }
    return c.json({ error: "AUTH_REQUIRED" }, 401);
  });
  test.route("/api/v1", marketRoutes);
  test.route("/api/v1", createFeeRoutes(() => fake));
  return test;
}

describe("POST /api/v1/market/payjp/tenant(V3-MKT-62 テナント test-mode 作成)", () => {
  it("認証なし → 401", async () => {
    const test = mountWithFakeConnector();
    const res = await test.request("/api/v1/market/payjp/tenant", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }, makeEnv());
    expect(res.status).toBe(401);
  });

  it("必須項目欠如 → 400", async () => {
    const test = mountWithFakeConnector();
    const sellerH = bearer(await issueSessionToken("pj-seller1", SESSION_SECRET));
    const res = await test.request(
      "/api/v1/market/payjp/tenant",
      { method: "POST", headers: sellerH, body: JSON.stringify({}) },
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("正常値 → 201・作成された tenant を返す", async () => {
    const test = mountWithFakeConnector({ tenant: { id: "ten_seller1", name: "seller1" } });
    const sellerH = bearer(await issueSessionToken("pj-seller2", SESSION_SECRET));
    const res = await test.request(
      "/api/v1/market/payjp/tenant",
      {
        method: "POST",
        headers: sellerH,
        body: JSON.stringify({
          bankAccountHolderName: "ホルダー",
          bankCode: "0001",
          bankBranchCode: "001",
          bankAccountType: "普通",
          bankAccountNumber: "1234567",
        }),
      },
      makeEnv(),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ tenant: { id: "ten_seller1" } });
  });
});

describe("POST /api/v1/market/listings/{id}/payjp-charge(V3-MKT-62/63 Platform charge)", () => {
  it("matched buyer でない actor → 403", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("pj-s1", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("pj-b1", SESSION_SECRET));
    const other = bearer(await issueSessionToken("pj-other1", SESSION_SECRET));
    const id = ulid();
    await createListing(env, sellerH, id, 1000);
    await transition(env, sellerH, id, { kind: "list_fixed" });
    await sleep(2);
    await transition(env, buyerH, id, { kind: "match" });
    await sleep(2);

    const test = mountWithFakeConnector();
    const res = await test.request(
      `/api/v1/market/listings/${id}/payjp-charge`,
      { method: "POST", headers: other, body: JSON.stringify({ amount: 1000, card: "tok_x", tenant: "ten_x" }) },
      env,
    );
    expect(res.status).toBe(403);
  });

  it("charge 成功(paid) → 201・pay_confirm(method=payjp_platform)が state に反映される", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("pj-s2", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("pj-b2", SESSION_SECRET));
    const id = ulid();
    await createListing(env, sellerH, id, 1000);
    await transition(env, sellerH, id, { kind: "list_fixed" });
    await sleep(2);
    await transition(env, buyerH, id, { kind: "match" });
    await sleep(2);

    const test = mountWithFakeConnector({
      charge: { id: "ch_p2", amount: 1000, currency: "jpy", paid: true, captured: true, metadata: {}, tenant: "ten_x", platform_fee: 50 },
    });
    const res = await test.request(
      `/api/v1/market/listings/${id}/payjp-charge`,
      { method: "POST", headers: buyerH, body: JSON.stringify({ amount: 1000, card: "tok_x", tenant: "ten_x" }) },
      env,
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ listing_id: id, charge_id: "ch_p2", amount: 1000, platform_fee: 50 });

    const st = (await (
      await app.request(`/api/v1/market/listings/${id}/state`, { headers: sellerH }, env)
    ).json()) as { payment: { method: string; payjp_charge_id?: string; confirmed_at?: string } };
    expect(st.payment.method).toBe("payjp_platform");
    expect(st.payment.payjp_charge_id).toBe("ch_p2");
    expect(st.payment.confirmed_at).toBeDefined();
  });

  it("同一 charge の再送 → 200 duplicate(冪等)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("pj-s3", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("pj-b3", SESSION_SECRET));
    const id = ulid();
    await createListing(env, sellerH, id, 500);
    await transition(env, sellerH, id, { kind: "list_fixed" });
    await sleep(2);
    await transition(env, buyerH, id, { kind: "match" });
    await sleep(2);

    const test = mountWithFakeConnector({
      charge: { id: "ch_p3", amount: 500, currency: "jpy", paid: true, captured: true, metadata: {}, tenant: "ten_x", platform_fee: 25 },
    });
    const body = JSON.stringify({ amount: 500, card: "tok_x", tenant: "ten_x" });
    const first = await test.request(`/api/v1/market/listings/${id}/payjp-charge`, { method: "POST", headers: buyerH, body }, env);
    expect(first.status).toBe(201);
    const second = await test.request(`/api/v1/market/listings/${id}/payjp-charge`, { method: "POST", headers: buyerH, body }, env);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ ok: true, duplicate: true, charge_id: "ch_p3" });
  });

  it("charge 未払い(paid=false) → 402・取引状態は変化しない", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("pj-s4", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("pj-b4", SESSION_SECRET));
    const id = ulid();
    await createListing(env, sellerH, id, 500);
    await transition(env, sellerH, id, { kind: "list_fixed" });
    await sleep(2);
    await transition(env, buyerH, id, { kind: "match" });
    await sleep(2);

    const test = mountWithFakeConnector({
      charge: { id: "ch_p4", amount: 500, currency: "jpy", paid: false, captured: false, metadata: {}, tenant: "ten_x", platform_fee: 25 },
    });
    const res = await test.request(
      `/api/v1/market/listings/${id}/payjp-charge`,
      { method: "POST", headers: buyerH, body: JSON.stringify({ amount: 500, card: "tok_x", tenant: "ten_x" }) },
      env,
    );
    expect(res.status).toBe(402);
    const st = (await (await app.request(`/api/v1/market/listings/${id}/state`, { headers: sellerH }, env)).json()) as { payment: { method: string } };
    expect(st.payment.method).toBe("bank_transfer"); // 未確定=既定のまま
  });
});

describe("V3-MKT-63 PAY.JP Platform 取引は fee-routes ゆる請求(5%義務)を二重計上しない", () => {
  it("payjp_platform で pay_confirm 後、receive+rate で成立しても /me/fees に追加義務が立たない", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("pj-s5", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("pj-b5", SESSION_SECRET));
    const id = ulid();
    await createListing(env, sellerH, id, 2000);
    await transition(env, sellerH, id, { kind: "list_fixed" });
    await sleep(2);
    await transition(env, buyerH, id, { kind: "match" });
    await sleep(2);

    const test = mountWithFakeConnector({
      charge: { id: "ch_p5", amount: 2000, currency: "jpy", paid: true, captured: true, metadata: {}, tenant: "ten_x", platform_fee: 100 },
    });
    const chargeRes = await test.request(
      `/api/v1/market/listings/${id}/payjp-charge`,
      { method: "POST", headers: buyerH, body: JSON.stringify({ amount: 2000, card: "tok_x", tenant: "ten_x" }) },
      env,
    );
    expect(chargeRes.status).toBe(201);
    await sleep(2);

    await transition(env, sellerH, id, { kind: "ship" });
    await sleep(2);
    await transition(env, buyerH, id, { kind: "receive" });
    await sleep(2);
    await transition(env, buyerH, id, { kind: "rate" });
    await sleep(2);

    const fees = (await (
      await app.request("/api/v1/me/fees", { headers: sellerH }, env)
    ).json()) as { unpaid_count: number; items: unknown[] };
    expect(fees.unpaid_count).toBe(0); // Platform charge が 5% を自動控除済み(二重徴収なし)
  });
});
