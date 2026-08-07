// V3-MKT-62/63(round-16裁定・P2P決済ユーザー選択制+PAY.JP Platform 5%自動控除)。
// 2026-08-07裁定(review-queue\R0807-054187-payjp-charge-route-2026-08-07.json ROUTE-1=○)
// により POST /market/payjp/tenant・POST /market/listings/{id}/payjp-charge の2 route は
// fee-routes.ts から退役済み。旧2 describe(tenant作成/Platform charge)は削除し、退役後の
// 契約(未登録であること)を検証する describe へ置換した。二重計上ガード(V3-MKT-63)の
// describe は、route を経由せず /transition の pay_confirm(payload.method=payjp_platform)
// を直接叩く形へ書き換えて維持する(market-settlement.ts の payjp_platform 分岐は現役)。
import { describe, expect, it } from "vitest";
import { ulid } from "@ihl/truth";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
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

describe("V3-MKT-62/63 退役: PAY.JP Platform 2 route は登録されていない(2026-08-07裁定PAY-1)", () => {
  it("POST /market/payjp/tenant(未認証) → 実測ステータスを主張する", async () => {
    const res = await app.request(
      "/api/v1/market/payjp/tenant",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      makeEnv(),
    );
    // 実測(下記報告書 §3 検証出力): index.ts のグローバル deny-by-default ゲートが
    // 未登録パスでも未認証なら先に 401 AUTH_REQUIRED を返す。
    expect(res.status).toBe(401);
  });

  it("POST /market/payjp/tenant(認証済み) → 実測ステータスを主張する", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const h = bearer(await issueSessionToken("retire-check-1", SESSION_SECRET));
    const res = await app.request(
      "/api/v1/market/payjp/tenant",
      { method: "POST", headers: h, body: "{}" },
      env,
    );
    // 実測(下記報告書 §3 検証出力): 認証済みでも route 未登録のため Hono ルーターが 404 を返す。
    expect(res.status).toBe(404);
  });

  it("POST /market/listings/{id}/payjp-charge(未認証) → 実測ステータスを主張する", async () => {
    const res = await app.request(
      "/api/v1/market/listings/RETIRE1/payjp-charge",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      makeEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("POST /market/listings/{id}/payjp-charge(認証済み) → 実測ステータスを主張する", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const h = bearer(await issueSessionToken("retire-check-2", SESSION_SECRET));
    const res = await app.request(
      "/api/v1/market/listings/RETIRE1/payjp-charge",
      { method: "POST", headers: h, body: "{}" },
      env,
    );
    expect(res.status).toBe(404);
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

    // route(退役済み)を経由せず、market-settlement.ts の payjp_platform 分岐(現役)を
    // /transition の pay_confirm(payload.method=payjp_platform)経由で直接駆動する
    // (旧 fee-routes.ts の payjp-charge ハンドラも内部的に kind: pay_confirm・
    // payload: { method: "payjp_platform", charge_id } を書いていたのと同じ形)。
    const chargeRes = await transition(env, sellerH, id, {
      kind: "pay_confirm",
      amount: 2000,
      payload: { method: "payjp_platform", charge_id: "ch_p5" },
    });
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
