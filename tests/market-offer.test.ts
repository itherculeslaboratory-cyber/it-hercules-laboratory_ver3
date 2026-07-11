// MKT-06 直接オファー / ラブレター TC。ラブレターは値段非開示で集約→出品者が選んで
// 成立、自分の出品には出せない(403)、オファーを受けないチャネル(auction)は拒否
// ポリシーで 409(design-k3 §2.2/§2.3)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}
function transition(env: object, headers: Record<string, string>, id: string, body: unknown) {
  return app.request(
    `/api/v1/market/listings/${id}/transition`,
    { method: "POST", headers, body: JSON.stringify(body) },
    env,
  );
}
function offer(env: object, headers: Record<string, string>, body: unknown) {
  return app.request("/api/v1/market/offers", { method: "POST", headers, body: JSON.stringify(body) }, env);
}

describe("MKT-06 ラブレター/オファー", () => {
  it("ラブレターは受理され、値段は応答に載らない(非開示)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("seller", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("buyer", SESSION_SECRET));
    await transition(env, sellerH, "L1", { kind: "list_fixed" });
    const r = await offer(env, buyerH, { listing_id: "L1", love_letter: true, amount: 9000 });
    expect(r.status).toBe(201);
    const j = (await r.json()) as Record<string, unknown>;
    expect(j.kind).toBe("love_letter");
    expect("amount" in j).toBe(false);
  });

  it("自分の出品にはオファーできない(403)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("seller", SESSION_SECRET));
    await transition(env, sellerH, "L1", { kind: "list_fixed" });
    expect((await offer(env, sellerH, { listing_id: "L1", amount: 100 })).status).toBe(403);
  });

  it("オークションは直接オファーを拒否(409 拒否ポリシー)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("seller", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("buyer", SESSION_SECRET));
    await transition(env, sellerH, "L1", { kind: "list_auction" });
    expect((await offer(env, buyerH, { listing_id: "L1", amount: 100 })).status).toBe(409);
  });

  it("ラブレターを集約(ボードで値段非開示)し、出品者が1件選んで成立", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("seller", SESSION_SECRET));
    const b1 = bearer(await issueSessionToken("buyer1", SESSION_SECRET));
    const b2 = bearer(await issueSessionToken("buyer2", SESSION_SECRET));
    await transition(env, sellerH, "L1", { kind: "list_fixed" });
    await offer(env, b1, { listing_id: "L1", love_letter: true, amount: 8000 });
    await offer(env, b2, { listing_id: "L1", love_letter: true, amount: 9000 });

    const st = (await (
      await app.request("/api/v1/market/listings/L1/state", { headers: sellerH }, env)
    ).json()) as { state: string };
    expect(st.state).toBe("offer_pending");

    const m = await transition(env, sellerH, "L1", { kind: "match", counterparty: "buyer2" });
    expect(m.status).toBe(201);
    expect(((await m.json()) as { state: string }).state).toBe("matched");

    const bd = (await (
      await app.request("/api/v1/market/listings/L1/board", { headers: sellerH }, env)
    ).json()) as { offers: { kind: string; amount?: number }[] };
    const letters = bd.offers.filter((o) => o.kind === "love_letter");
    expect(letters.length).toBe(2);
    for (const l of letters) expect(l.amount).toBeUndefined(); // 値段非開示
  });
});
