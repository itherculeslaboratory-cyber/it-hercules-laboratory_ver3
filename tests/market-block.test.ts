// V3-MKT-61 ブロックしたユーザーとは取引不可(オファー/入札/即決申込/予約)。掲示板・
// 議論は不干渉(本ファイルは市場 route のガードのみ検証・plaza は別 route で無配線)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}
function post(env: object, headers: Record<string, string>, path: string, body: unknown) {
  return app.request(`/api/v1${path}`, { method: "POST", headers, body: JSON.stringify(body) }, env);
}
function get(env: object, headers: Record<string, string>, path: string) {
  return app.request(`/api/v1${path}`, { headers }, env);
}
function transition(env: object, headers: Record<string, string>, id: string, body: unknown) {
  return post(env, headers, `/market/listings/${id}/transition`, body);
}

describe("V3-MKT-61 ブロック関係の登録/解除", () => {
  it("ブロック追加→一覧に載る→unblock で消える(LWW投影)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const aH = bearer(await issueSessionToken("a", SESSION_SECRET));
    const r1 = await post(env, aH, "/market/blocks", { blocked_actor_id: "b" });
    expect(r1.status).toBe(201);
    const list1 = (await (await get(env, aH, "/market/blocks")).json()) as { blocked_actor_ids: string[] };
    expect(list1.blocked_actor_ids).toEqual(["b"]);

    const r2 = await post(env, aH, "/market/blocks", { blocked_actor_id: "b", action: "unblock" });
    expect(r2.status).toBe(201);
    const list2 = (await (await get(env, aH, "/market/blocks")).json()) as { blocked_actor_ids: string[] };
    expect(list2.blocked_actor_ids).toEqual([]);
  });

  it("自分自身はブロックできない(400)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const aH = bearer(await issueSessionToken("a", SESSION_SECRET));
    expect((await post(env, aH, "/market/blocks", { blocked_actor_id: "a" })).status).toBe(400);
  });
});

describe("V3-MKT-61 取引ガード: ブロック関係とは取引不可", () => {
  it("出品者が買い手をブロック済みなら買い手の offer は 403(BLOCKED)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("seller", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("buyer", SESSION_SECRET));
    await transition(env, sellerH, "L1", { kind: "list_fixed", accept_mode: "consent" });
    await post(env, sellerH, "/market/blocks", { blocked_actor_id: "buyer" });

    const r = await post(env, buyerH, "/market/offers", { listing_id: "L1", amount: 100 });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: string }).error).toBe("BLOCKED");
  });

  it("買い手が出品者をブロック済みでも同様に 403(双方向遮断)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("seller2", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("buyer2", SESSION_SECRET));
    await transition(env, sellerH, "L2", { kind: "list_fixed", accept_mode: "consent" });
    await post(env, buyerH, "/market/blocks", { blocked_actor_id: "seller2" });

    const r = await post(env, buyerH, "/market/offers", { listing_id: "L2", amount: 100 });
    expect(r.status).toBe(403);
  });

  it("即決(instant)自己申込(match)もブロック関係なら 403", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("seller3", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("buyer3", SESSION_SECRET));
    await transition(env, sellerH, "L3", { kind: "list_fixed" }); // accept_mode 省略=即決既定
    await post(env, sellerH, "/market/blocks", { blocked_actor_id: "buyer3" });

    const r = await transition(env, buyerH, "L3", { kind: "match" });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: string }).error).toBe("BLOCKED");
  });

  it("入札(bid)もブロック関係なら 403", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("seller4", SESSION_SECRET));
    const bidderH = bearer(await issueSessionToken("bidder4", SESSION_SECRET));
    await transition(env, sellerH, "L4", { kind: "list_auction" });
    await post(env, sellerH, "/market/blocks", { blocked_actor_id: "bidder4" });

    const r = await transition(env, bidderH, "L4", { kind: "bid", amount: 500 });
    expect(r.status).toBe(403);
  });

  it("ブロックされていない相手とは通常どおり取引できる", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("seller5", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("buyer5", SESSION_SECRET));
    await transition(env, sellerH, "L5", { kind: "list_fixed" });
    const r = await transition(env, buyerH, "L5", { kind: "match" });
    expect(r.status).toBe(201);
  });
});
