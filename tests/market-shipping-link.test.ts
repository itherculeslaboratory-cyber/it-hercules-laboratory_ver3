// V3-MKT-20(round-15裁定・匿名配送=外部URL中継に差替)TC。IHL は住所を一切保持せず、
// 入金確認(pay_confirm)後に売り手が発行する外部誘導URL(日本郵便『ゆうパックスマホ割』
// 等)を中継するだけ(kind=ship_link)。中継先は当事者2人限定の非公開ボードでのみ開示し、
// 公開の GET /state には出さない。文言・実装は誘導リンクのrelayに徹し、適法性は断定しない。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}
function transition(env: object, headers: Record<string, string>, id: string, body: unknown) {
  return app.request(`/api/v1/market/listings/${id}/transition`, { method: "POST", headers, body: JSON.stringify(body) }, env);
}
function board(env: object, headers: Record<string, string>, id: string) {
  return app.request(`/api/v1/market/listings/${id}/board`, { headers }, env);
}
function state(env: object, headers: Record<string, string>, id: string) {
  return app.request(`/api/v1/market/listings/${id}/state`, { headers }, env);
}

const EXTERNAL_URL = "https://example-post.invalid/yu-pack-smapo/session/abc123";
// ULID は同一ミリ秒内で単調増加しない(packages/truth/src/ulid.ts)ため、reduceMarket の
// created_at 同値タイブレークが順序を保証しない。既存の settings-preferences.test.ts と
// 同じ回避策(2ms 空けて created_at を確実に進める)を連続 transition 間に挟む。
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function toMatchedPaid(env: object, sellerH: Record<string, string>, buyerH: Record<string, string>, id: string) {
  await transition(env, sellerH, id, { kind: "list_fixed" });
  await sleep(2);
  await transition(env, buyerH, id, { kind: "match" });
  await sleep(2);
  await transition(env, buyerH, id, { kind: "pay_declare", amount: 1000 });
  await sleep(2);
  await transition(env, sellerH, id, { kind: "pay_confirm", amount: 1000 });
  await sleep(2);
}

describe("V3-MKT-20 外部URL中継(ship_link)", () => {
  it("入金確認前は ship_link が409(PAYMENT_NOT_CONFIRMED)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("sl-seller1", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("sl-buyer1", SESSION_SECRET));
    await transition(env, sellerH, "SL1", { kind: "list_fixed" });
    await transition(env, buyerH, "SL1", { kind: "match" });

    const r = await transition(env, sellerH, "SL1", { kind: "ship_link", payload: { external_shipping_url: EXTERNAL_URL } });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toBe("PAYMENT_NOT_CONFIRMED");
  });

  it("URL未指定は400", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("sl-seller2", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("sl-buyer2", SESSION_SECRET));
    await toMatchedPaid(env, sellerH, buyerH, "SL2");
    const r = await transition(env, sellerH, "SL2", { kind: "ship_link", payload: {} });
    expect(r.status).toBe(400);
  });

  it("買い手からの ship_link は 403(売り手限定)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("sl-seller3", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("sl-buyer3", SESSION_SECRET));
    await toMatchedPaid(env, sellerH, buyerH, "SL3");
    const r = await transition(env, buyerH, "SL3", { kind: "ship_link", payload: { external_shipping_url: EXTERNAL_URL } });
    expect(r.status).toBe(403);
  });

  it("入金確認後、売り手のship_linkは201・非公開ボードで当事者2人にだけ開示・公開stateには出さない", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("sl-seller4", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("sl-buyer4", SESSION_SECRET));
    const strangerH = bearer(await issueSessionToken("sl-stranger4", SESSION_SECRET));
    await toMatchedPaid(env, sellerH, buyerH, "SL4");

    const r = await transition(env, sellerH, "SL4", { kind: "ship_link", payload: { external_shipping_url: EXTERNAL_URL } });
    expect(r.status).toBe(201);
    expect(((await r.json()) as { state: string }).state).toBe("matched"); // 住所非保持=状態機械は動かない副次イベント

    const sellerBoard = (await (await board(env, sellerH, "SL4")).json()) as { shipping_link: { url?: string; posted_by?: string } };
    expect(sellerBoard.shipping_link.url).toBe(EXTERNAL_URL);
    expect(sellerBoard.shipping_link.posted_by).toBe("sl-seller4");

    const buyerBoard = (await (await board(env, buyerH, "SL4")).json()) as { shipping_link: { url?: string } };
    expect(buyerBoard.shipping_link.url).toBe(EXTERNAL_URL);

    const strangerBoard = await board(env, strangerH, "SL4");
    expect(strangerBoard.status).toBe(403);

    // 公開 GET /state には URL を出さない(当事者限定のボードのみ)。
    const publicState = (await (await state(env, strangerH, "SL4")).json()) as Record<string, unknown>;
    expect(publicState).not.toHaveProperty("shipping_link");
  });

  it("ship→receive の通常フローと共存できる(状態機械を阻害しない)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("sl-seller5", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("sl-buyer5", SESSION_SECRET));
    await toMatchedPaid(env, sellerH, buyerH, "SL5");
    await transition(env, sellerH, "SL5", { kind: "ship_link", payload: { external_shipping_url: EXTERNAL_URL } });
    await sleep(2);
    const shipRes = await transition(env, sellerH, "SL5", { kind: "ship" });
    expect(shipRes.status).toBe(201);
    expect(((await shipRes.json()) as { state: string }).state).toBe("shipped");
    await sleep(2);

    // shipped の後でも ship_link を再送(更新)できる(matched/shipped 両方で自己ループ)。
    const relink = await transition(env, sellerH, "SL5", { kind: "ship_link", payload: { external_shipping_url: EXTERNAL_URL + "?resend=1" } });
    expect(relink.status).toBe(201);
  });
});
