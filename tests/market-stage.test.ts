// MKT-03 ステージ/非公開ボード TC。matched 以降の private board は当事者2人のみ
// (第三者 403・matched 前は 404)、落札(auction の match)は Stage1 の私的交渉を経ず
// Stage2 直行(design-k3 §2.3)。route 経由で actor を分けて検証。
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
function board(env: object, headers: Record<string, string>, id: string) {
  return app.request(`/api/v1/market/listings/${id}/board`, { headers }, env);
}
async function stage(env: object, headers: Record<string, string>, id: string): Promise<number> {
  const j = (await (await app.request(`/api/v1/market/listings/${id}/state`, { headers }, env)).json()) as {
    stage: number;
  };
  return j.stage;
}

describe("MKT-03 非公開ボード", () => {
  it("matched 前はボード未開放(404)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("seller", SESSION_SECRET));
    await transition(env, sellerH, "L1", { kind: "list_fixed" });
    expect((await board(env, sellerH, "L1")).status).toBe(404);
  });

  it("matched 後は当事者2人のみ 200・第三者は 403", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("seller", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("buyer", SESSION_SECRET));
    const strangerH = bearer(await issueSessionToken("stranger", SESSION_SECRET));
    await transition(env, sellerH, "L1", { kind: "list_fixed" });
    await transition(env, sellerH, "L1", { kind: "match", counterparty: "buyer" });
    expect((await board(env, sellerH, "L1")).status).toBe(200);
    expect((await board(env, buyerH, "L1")).status).toBe(200);
    expect((await board(env, strangerH, "L1")).status).toBe(403);
  });
});

describe("MKT-03 落札は Stage2 直行", () => {
  it("公開中は Stage1、落札(match)で Stage2 へ直行", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("seller", SESSION_SECRET));
    const bidderH = bearer(await issueSessionToken("bidder", SESSION_SECRET));
    await transition(env, sellerH, "L1", { kind: "list_auction" });
    await transition(env, bidderH, "L1", { kind: "bid", amount: 500 });
    expect(await stage(env, sellerH, "L1")).toBe(1); // 公開中(Stage1)
    const m = await transition(env, sellerH, "L1", { kind: "match", counterparty: "bidder" });
    expect(m.status).toBe(201);
    expect(await stage(env, sellerH, "L1")).toBe(2); // Stage1 私的交渉を経ず Stage2 直行
  });
});
