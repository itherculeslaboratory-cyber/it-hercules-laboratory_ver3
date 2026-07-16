// V3-MKT-13(round-15裁定・部分入金・過入金)TC。銀行振込P2Pでは売主の自己申告確認に
// なったため、受取確定フローに「金額相違」自己申告オプション(pay_confirm の
// payload.mismatch=partial|over)を足す。部分入金=義務は消えない(残債の再申告待ち)・
// 過入金=クレジット記録のみ(返金・自動充当・自動制裁は一切行わないゆる運用)。
// 併せて、pay_declare/pay_confirm が MARKET_EDGES に自己ループ登録されておらず
// POST /transition から常に409になっていた既存ギャップの回帰も検証する(root-cause fix)。
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
function state(env: object, headers: Record<string, string>, id: string) {
  return app.request(`/api/v1/market/listings/${id}/state`, { headers }, env);
}
// ULID は同一ミリ秒内で単調増加しない(packages/truth/src/ulid.ts)ため、reduceMarket/
// projectPayment の created_at 同値タイブレークが呼び出し順を保証しない。既存の
// settings-preferences.test.ts と同じ回避策(2ms 空けて created_at を確実に進める)を
// 連続 transition 間に挟む。
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("V3-MKT-13 pay_declare/pay_confirm are reachable via /transition (regression)", () => {
  it("pay_declare(buyer)->pay_confirm(seller) 201・state は matched のまま", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("pm-seller1", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("pm-buyer1", SESSION_SECRET));
    await transition(env, sellerH, "PM1", { kind: "list_fixed" });
    await sleep(2);
    await transition(env, buyerH, "PM1", { kind: "match" });
    await sleep(2);

    const d = await transition(env, buyerH, "PM1", { kind: "pay_declare", amount: 1000 });
    expect(d.status).toBe(201);
    expect(((await d.json()) as { state: string }).state).toBe("matched");
    await sleep(2);

    const cf = await transition(env, sellerH, "PM1", { kind: "pay_confirm", amount: 1000 });
    expect(cf.status).toBe(201);
    expect(((await cf.json()) as { state: string }).state).toBe("matched");

    const st = (await (await state(env, sellerH, "PM1")).json()) as {
      payment: { declared_at?: string; confirmed_at?: string; declared_amount?: number; confirmed_amount?: number; mismatch?: string };
    };
    expect(st.payment.declared_at).toBeDefined();
    expect(st.payment.confirmed_at).toBeDefined();
    expect(st.payment.declared_amount).toBe(1000);
    expect(st.payment.confirmed_amount).toBe(1000);
    expect(st.payment.mismatch).toBeUndefined();
  });

  it("買い手でない pay_declare / 出品者でない pay_confirm は 403(当事者ガード)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("pm-seller2", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("pm-buyer2", SESSION_SECRET));
    await transition(env, sellerH, "PM2", { kind: "list_fixed" });
    await sleep(2);
    await transition(env, buyerH, "PM2", { kind: "match" });
    await sleep(2);

    expect((await transition(env, sellerH, "PM2", { kind: "pay_declare", amount: 100 })).status).toBe(403);
    expect((await transition(env, buyerH, "PM2", { kind: "pay_confirm", amount: 100 })).status).toBe(403);
  });
});

describe("V3-MKT-13 金額相違自己申告(partial/over・ゆる運用=自動制裁なし)", () => {
  it("部分入金(partial): 義務は消えない(state不変・mismatch記録のみ)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("pm-seller3", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("pm-buyer3", SESSION_SECRET));
    await transition(env, sellerH, "PM3", { kind: "list_fixed" });
    await sleep(2);
    await transition(env, buyerH, "PM3", { kind: "match" });
    await sleep(2);
    await transition(env, buyerH, "PM3", { kind: "pay_declare", amount: 600 });
    await sleep(2);

    const cf = await transition(env, sellerH, "PM3", { kind: "pay_confirm", amount: 600, payload: { mismatch: "partial" } });
    expect(cf.status).toBe(201);
    expect(((await cf.json()) as { state: string }).state).toBe("matched"); // 義務は消えない=state不変

    const st = (await (await state(env, sellerH, "PM3")).json()) as { payment: { mismatch?: string; confirmed_amount?: number } };
    expect(st.payment.mismatch).toBe("partial");
    expect(st.payment.confirmed_amount).toBe(600);
    await sleep(2);

    // 残額の再申告(買主が追加で pay_declare)→ 売主が過不足なしで再確認できる。
    await transition(env, buyerH, "PM3", { kind: "pay_declare", amount: 400 });
    await sleep(2);
    const cf2 = await transition(env, sellerH, "PM3", { kind: "pay_confirm", amount: 1000 });
    expect(cf2.status).toBe(201);
    const st2 = (await (await state(env, sellerH, "PM3")).json()) as { payment: { mismatch?: string; confirmed_amount?: number } };
    expect(st2.payment.mismatch).toBeUndefined(); // 直近の pay_confirm が正本(mismatch省略=一致)
    expect(st2.payment.confirmed_amount).toBe(1000);
  });

  it("過入金(over): クレジット記録のみ・自動制裁/自動キャンセルなし", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("pm-seller4", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("pm-buyer4", SESSION_SECRET));
    await transition(env, sellerH, "PM4", { kind: "list_fixed" });
    await sleep(2);
    await transition(env, buyerH, "PM4", { kind: "match" });
    await sleep(2);
    await transition(env, buyerH, "PM4", { kind: "pay_declare", amount: 1200 });
    await sleep(2);

    const cf = await transition(env, sellerH, "PM4", { kind: "pay_confirm", amount: 1200, payload: { mismatch: "over" } });
    expect(cf.status).toBe(201);

    const st = (await (await state(env, sellerH, "PM4")).json()) as { state: string; payment: { mismatch?: string } };
    expect(st.payment.mismatch).toBe("over");
    expect(st.state).toBe("matched"); // 自動制裁・自動キャンセルは一切発火しない
    await sleep(2);

    // 取引は通常どおり進められる(ゆる運用)。
    const ship = await transition(env, sellerH, "PM4", { kind: "ship" });
    expect(ship.status).toBe(201);
  });

  it("mismatch は 'partial'|'over' 以外を拒否する(400)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("pm-seller5", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("pm-buyer5", SESSION_SECRET));
    await transition(env, sellerH, "PM5", { kind: "list_fixed" });
    await sleep(2);
    await transition(env, buyerH, "PM5", { kind: "match" });
    await sleep(2);
    const r = await transition(env, sellerH, "PM5", { kind: "pay_confirm", amount: 100, payload: { mismatch: "bogus" } });
    expect(r.status).toBe(400);
  });
});
