// V3-MKT-10(残作業「取引成立からの義務自動計上」)TC。receive∧rate が揃い取引成立
// (MKT-04)した瞬間、5% 維持費税を義務台帳(OBLIGATION_TYPE・fee-routes.ts のゆる請求
// フローがそのまま読む)へ自動 append する。gross は pay_confirm確認額 > pay_declare
// 申告額 > listing.price の順(全欠落なら課税しない=ゆる請求・取り逃し許容)。
// 1 listing = 1 obligation(put-if-absent の deterministic key で冪等・rate→receive の
// 逆順でも二重計上しない)。
import { describe, expect, it } from "vitest";
import { ulid } from "@ihl/truth";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { FEE_MAINTENANCE_TAX_RATE, TAX_GRACE_DAYS } from "../apps/api/src/economy-constants";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}
function transition(env: object, headers: Record<string, string>, id: string, body: unknown) {
  return app.request(`/api/v1/market/listings/${id}/transition`, { method: "POST", headers, body: JSON.stringify(body) }, env);
}
function myFees(env: object, headers: Record<string, string>) {
  return app.request("/api/v1/me/fees", { headers }, env);
}
// listing.price フォールバックの検証には実在の listing レコード(POST /market/listings)が
// 要る(transition だけ叩く既存 market TC 群は listing_id を opaque な状態機械キーとして
// 直接使うため listing レコード自体を作らない=price を読めない・本 TC 特有の前準備)。
function createListing(env: object, headers: Record<string, string>, listingId: string, price?: number) {
  const body: Record<string, unknown> = { listing_id: listingId, title: `listing ${listingId}` };
  if (price !== undefined) body.price = price;
  return app.request("/api/v1/market/listings", { method: "POST", headers, body: JSON.stringify(body) }, env);
}
// ULID は同一ミリ秒内で単調増加しない(packages/truth/src/ulid.ts)ため、既存 market TC と
// 同じ回避策(2ms 空けて created_at を確実に進める)を連続 transition 間に挟む。
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FeeItem {
  obligation_id: string;
  obligation_kind: string;
  amount: number;
  due_date: string;
  paid: boolean;
}

describe("V3-MKT-10 取引成立時の 5% 維持費税自動計上", () => {
  it("pay_confirm確認額を優先して5%の義務を売り手に自動計上(receive→rateの順)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("fo-seller1", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("fo-buyer1", SESSION_SECRET));
    const id = ulid();
    await createListing(env, sellerH, id, 5000);
    await transition(env, sellerH, id, { kind: "list_fixed" });
    await sleep(2);
    await transition(env, buyerH, id, { kind: "match" });
    await sleep(2);
    await transition(env, buyerH, id, { kind: "pay_declare", amount: 10000 });
    await sleep(2);
    await transition(env, sellerH, id, { kind: "pay_confirm", amount: 10000 }); // confirmed_amount が gross
    await sleep(2);
    await transition(env, sellerH, id, { kind: "ship" });
    await sleep(2);
    const beforeSettle = await myFees(env, sellerH);
    expect(((await beforeSettle.json()) as { items: FeeItem[] }).items).toHaveLength(0); // 成立前は未計上

    const beforeRate = Date.now();
    await transition(env, buyerH, id, { kind: "receive" });
    await sleep(2);
    const rate = await transition(env, buyerH, id, { kind: "rate" }); // これで settled=true
    expect(rate.status).toBe(201);

    const res = await myFees(env, sellerH);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: FeeItem[]; unpaid_total: number };
    expect(body.items).toHaveLength(1);
    const item = body.items[0];
    expect(item.obligation_kind).toBe("fee_tax");
    expect(item.amount).toBe(Math.round(10000 * FEE_MAINTENANCE_TAX_RATE)); // 500(listing.priceの5000ではない)
    expect(item.paid).toBe(false);
    expect(body.unpaid_total).toBe(500);

    // due_date = 成立時刻 + 30日猶予(近似検証・秒単位の誤差を許容)。
    const dueMs = new Date(item.due_date).getTime();
    expect(dueMs).toBeGreaterThan(beforeRate + (TAX_GRACE_DAYS - 1) * 86_400_000);
    expect(dueMs).toBeLessThan(Date.now() + (TAX_GRACE_DAYS + 1) * 86_400_000);
  });

  it("pay_confirm/pay_declare が無ければ listing.price をgrossとして採用", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("fo-seller2", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("fo-buyer2", SESSION_SECRET));
    const id = ulid();
    await createListing(env, sellerH, id, 2000);
    await transition(env, sellerH, id, { kind: "list_fixed" });
    await sleep(2);
    await transition(env, buyerH, id, { kind: "match" });
    await sleep(2);
    await transition(env, sellerH, id, { kind: "ship" });
    await sleep(2);
    await transition(env, buyerH, id, { kind: "rate" }); // rate→receive の逆順でも成立時に発火
    await sleep(2);
    const rec = await transition(env, buyerH, id, { kind: "receive" });
    expect(rec.status).toBe(201);

    const body = (await (await myFees(env, sellerH)).json()) as { items: FeeItem[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].amount).toBe(Math.round(2000 * FEE_MAINTENANCE_TAX_RATE)); // = 100
  });

  it("gross が全く決定できない(price無し・pay_*無し)場合は課税しない(ゆる請求=取り逃し許容)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("fo-seller3", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("fo-buyer3", SESSION_SECRET));
    await transition(env, sellerH, "FO3", { kind: "list_fixed" }); // price 省略
    await sleep(2);
    await transition(env, buyerH, "FO3", { kind: "match" });
    await sleep(2);
    await transition(env, sellerH, "FO3", { kind: "ship" });
    await sleep(2);
    await transition(env, buyerH, "FO3", { kind: "receive" });
    await sleep(2);
    await transition(env, buyerH, "FO3", { kind: "rate" });

    const body = (await (await myFees(env, sellerH)).json()) as { items: FeeItem[] };
    expect(body.items).toHaveLength(0);
  });

  it("義務は1 listingにつき1件のみ(冪等・二重計上しない)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("fo-seller4", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("fo-buyer4", SESSION_SECRET));
    const id = ulid();
    await createListing(env, sellerH, id, 3000);
    await transition(env, sellerH, id, { kind: "list_fixed" });
    await sleep(2);
    await transition(env, buyerH, id, { kind: "match" });
    await sleep(2);
    await transition(env, sellerH, id, { kind: "ship" });
    await sleep(2);
    await transition(env, buyerH, id, { kind: "receive" });
    await sleep(2);
    await transition(env, buyerH, id, { kind: "rate" }); // settled=true(1回目のトリガー)

    const body = (await (await myFees(env, sellerH)).json()) as { items: FeeItem[] };
    expect(body.items).toHaveLength(1); // receive/rate 両方が settled トリガーを呼んでも1件だけ
  });
});
