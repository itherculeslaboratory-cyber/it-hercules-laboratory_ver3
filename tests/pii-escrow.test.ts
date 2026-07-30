// V3-SEC-12: 局留め連絡先エスクロー。個人情報(氏名・配送先・銀行口座)を公開領域に
// 直書きさせず、取引ペア(本人+相手方)にのみ参照範囲を限定する。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { DEV_TOKEN, SESSION_SECRET, makeEnv } from "./helpers";

const AUTH = { Authorization: `Bearer ${DEV_TOKEN}`, "content-type": "application/json" };

function post(path: string, body: unknown, env: object, headers: Record<string, string> = AUTH) {
  return app.request(path, { method: "POST", headers, body: JSON.stringify(body) }, env);
}
function get(path: string, env: object, headers: Record<string, string> = AUTH) {
  return app.request(path, { headers }, env);
}
async function authFor(actorId: string) {
  const token = await issueSessionToken(actorId, SESSION_SECRET);
  return { Authorization: `Bearer ${token}`, "content-type": "application/json" };
}

describe("V3-SEC-12 POST /trade/escrow-contact", () => {
  it("未認証 → 401(deny-by-default)", async () => {
    const res = await app.request(
      "/api/v1/trade/escrow-contact",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) },
      makeEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("counterparty_actor_id/full_name 欠落 → 400", async () => {
    const res = await post("/api/v1/trade/escrow-contact", {}, makeEnv());
    expect(res.status).toBe(400);
  });

  it("counterparty_actor_id が本人と同一 → 400", async () => {
    const env = makeEnv();
    const headers = await authFor("actor-self");
    const res = await post("/api/v1/trade/escrow-contact", { counterparty_actor_id: "actor-self", full_name: "y" }, env, headers);
    expect(res.status).toBe(400);
  });

  it("第三者(本人でも相手方でもない)は参照できず403", async () => {
    const env = makeEnv();
    const sellerHeaders = await authFor("seller-1");
    const res = await post(
      "/api/v1/trade/escrow-contact",
      { counterparty_actor_id: "buyer-1", full_name: "田中" },
      env,
      sellerHeaders,
    );
    const { escrow_id } = (await res.json()) as { escrow_id: string };

    const buyerHeaders = await authFor("buyer-1");
    const buyerRead = await get(`/api/v1/trade/escrow-contact/${escrow_id}`, env, buyerHeaders);
    expect(buyerRead.status).toBe(200); // 相手方(counterparty)は参照できる

    const strangerHeaders = await authFor("stranger-1");
    const strangerRead = await get(`/api/v1/trade/escrow-contact/${escrow_id}`, env, strangerHeaders);
    expect(strangerRead.status).toBe(403);
  });

  it("登録→本人は参照できる(氏名/住所/口座を含む)", async () => {
    const env = makeEnv();
    const res = await post(
      "/api/v1/trade/escrow-contact",
      { counterparty_actor_id: "buyer-1", full_name: "山田太郎", address: "〒150-0001 東京都渋谷区1-2-3", bank_account: "1234567" },
      env,
    );
    expect(res.status).toBe(201);
    const { escrow_id } = (await res.json()) as { escrow_id: string };
    const read = await get(`/api/v1/trade/escrow-contact/${escrow_id}`, env);
    expect(read.status).toBe(200);
    const data = (await read.json()) as { full_name: string; counterparty_actor_id: string };
    expect(data.full_name).toBe("山田太郎");
    expect(data.counterparty_actor_id).toBe("buyer-1");
  });

  it("存在しないescrow_idは404", async () => {
    const res = await get("/api/v1/trade/escrow-contact/does-not-exist", makeEnv());
    expect(res.status).toBe(404);
  });
});
