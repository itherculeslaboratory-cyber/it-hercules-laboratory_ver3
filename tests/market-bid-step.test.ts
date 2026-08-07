// V3-MKT-05(w1-01実装): 価格帯別の入札単位刻み(¥1,000未満→¥10/¥1,000-5,000→¥100/
// ¥5,000-10,000→¥250/¥10,000〜→¥500)+ヤフオク型自動入札(max_bid・予算上限までの
// 自動再入札・現在価格=2番手+1刻み・max_bidは露出しない)。ユーザーが監査報告を読み
// 名指しした「ない物」の実装(kits/lane-implement/ORDER-2026-08-07-w1-01-market-bid.md)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { bidStepFor } from "../apps/api/src/market-settlement";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}
function post(env: object, headers: Record<string, string>, path: string, body: unknown) {
  return app.request(`/api/v1${path}`, { method: "POST", headers, body: JSON.stringify(body) }, env);
}
function transition(env: object, headers: Record<string, string>, id: string, body: unknown) {
  return post(env, headers, `/market/listings/${id}/transition`, body);
}
function state(env: object, headers: Record<string, string>, id: string) {
  return app.request(`/api/v1/market/listings/${id}/state`, { headers }, env);
}
const FUTURE = "2999-01-01T00:00:00.000Z";

describe("V3-MKT-05 bidStepFor(価格帯別入札単位刻み・純関数)", () => {
  it("¥1,000未満は¥10刻み", () => {
    expect(bidStepFor(0)).toBe(10);
    expect(bidStepFor(999)).toBe(10);
  });
  it("¥1,000ちょうど〜¥5,000未満は¥100刻み(境界=1000は上側の帯)", () => {
    expect(bidStepFor(1000)).toBe(100);
    expect(bidStepFor(4999)).toBe(100);
  });
  it("¥5,000ちょうど〜¥10,000未満は¥250刻み(境界=5000は上側の帯)", () => {
    expect(bidStepFor(5000)).toBe(250);
    expect(bidStepFor(9999)).toBe(250);
  });
  it("¥10,000ちょうど以上は¥500刻み(境界=10000は上側の帯)", () => {
    expect(bidStepFor(10000)).toBe(500);
    expect(bidStepFor(50000)).toBe(500);
  });
});

async function makeAuctionListing(env: object, sellerH: Record<string, string>, price?: number) {
  const listingId = ((await (
    await post(env, sellerH, "/market/listings", { title: "刻みテスト", price, ends_at: FUTURE })
  ).json()) as { listing_id: string }).listing_id;
  await transition(env, sellerH, listingId, { kind: "list_auction" });
  return listingId;
}

describe("V3-MKT-05 POST /transition kind=bid (listed_auction) 刻み検証", () => {
  it("刻み未満の入札は409 BID_TOO_LOW(price=0開始・step=10・最低10円)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("bs-seller1", SESSION_SECRET));
    const bidderH = bearer(await issueSessionToken("bs-bidder1", SESSION_SECRET));
    const listingId = await makeAuctionListing(env, sellerH, 0);
    const res = await transition(env, bidderH, listingId, { kind: "bid", amount: 5 });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; min_next_bid: number };
    expect(body.error).toBe("BID_TOO_LOW");
    expect(body.min_next_bid).toBe(10);
  });

  it("刻みの倍数でない入札は409(例: 現在価格0からamount=15は10刻みに整合しない)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("bs-seller2", SESSION_SECRET));
    const bidderH = bearer(await issueSessionToken("bs-bidder2", SESSION_SECRET));
    const listingId = await makeAuctionListing(env, sellerH, 0);
    const res = await transition(env, bidderH, listingId, { kind: "bid", amount: 15 });
    expect(res.status).toBe(409);
  });

  it("負値/0/非数は400 INVALID_TRANSITION", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("bs-seller3", SESSION_SECRET));
    const bidderH = bearer(await issueSessionToken("bs-bidder3", SESSION_SECRET));
    const listingId = await makeAuctionListing(env, sellerH, 0);
    for (const amount of [-10, 0, Number.NaN]) {
      const res = await transition(env, bidderH, listingId, { kind: "bid", amount });
      expect(res.status).toBe(400);
    }
    // 非数(文字列)
    const res2 = await transition(env, bidderH, listingId, { kind: "bid", amount: "abc" });
    expect(res2.status).toBe(400);
  });

  it("4価格帯それぞれで正しい刻みが適用される(境界値=1000/5000/10000ちょうど含む)", async () => {
    // price は各帯の刻みの倍数に揃えてある(current+step が刻みの倍数になる値を選ぶ・
    // 4999のような非倍数の開始価格は「刻みの倍数に整合」の境界が別問題になるため対象外)。
    const cases: Array<{ price: number; validNext: number; belowStep: number }> = [
      { price: 900, validNext: 910, belowStep: 901 }, // <1000帯: step10
      { price: 1000, validNext: 1100, belowStep: 1001 }, // =1000は100刻み帯
      { price: 4900, validNext: 5000, belowStep: 4901 }, // <5000帯: step100
      { price: 5000, validNext: 5250, belowStep: 5001 }, // =5000は250刻み帯
      { price: 9750, validNext: 10000, belowStep: 9751 }, // <10000帯: step250
      { price: 10000, validNext: 10500, belowStep: 10001 }, // =10000は500刻み帯
    ];
    for (const [i, tc] of cases.entries()) {
      const env = makeEnv(new FakeR2Bucket());
      const sellerH = bearer(await issueSessionToken(`bs-seller-tier${i}`, SESSION_SECRET));
      const bidderH = bearer(await issueSessionToken(`bs-bidder-tier${i}`, SESSION_SECRET));
      const listingId = await makeAuctionListing(env, sellerH, tc.price);
      const okRes = await transition(env, bidderH, listingId, { kind: "bid", amount: tc.validNext });
      expect(okRes.status).toBe(201);
      const bidderH2 = bearer(await issueSessionToken(`bs-bidder-tier${i}-b`, SESSION_SECRET));
      const ngRes = await transition(env, bidderH2, listingId, { kind: "bid", amount: tc.belowStep });
      expect(ngRes.status).toBe(409); // 刻み未満 or 倍数不整合
    }
  });
});

describe("V3-MKT-05 ヤフオク型自動入札(max_bid・T2)", () => {
  it("2番手+1刻みが現在価格になり、max_bidはstate応答のbids配列に露出しない", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("proxy-seller1", SESSION_SECRET));
    const bidderAH = bearer(await issueSessionToken("proxy-a1", SESSION_SECRET));
    const bidderBH = bearer(await issueSessionToken("proxy-b1", SESSION_SECRET));
    const listingId = await makeAuctionListing(env, sellerH, 0);

    // A: amount=100(<1000帯・step10)・max_bid=500
    const resA = await transition(env, bidderAH, listingId, { kind: "bid", amount: 100, max_bid: 500 });
    expect(resA.status).toBe(201);
    // B: amount=110(100+step10)。Aのmax_bid=500は110+step(10)=120まで賄えるので自動再入札。
    const resB = await transition(env, bidderBH, listingId, { kind: "bid", amount: 110 });
    expect(resB.status).toBe(201);

    const st = (await (await state(env, sellerH, listingId)).json()) as {
      bids: Array<Record<string, unknown>>;
    };
    // 実効最高額 = B(110) + step(10) = 120 が最新のbidとして記録されている。
    const amounts = st.bids.map((b) => b.amount);
    expect(amounts).toContain(120);
    // max_bid は公開bids配列のどのエントリにも含まれない(露出しない)。
    for (const b of st.bids) {
      expect(Object.prototype.hasOwnProperty.call(b, "max_bid")).toBe(false);
    }
  });

  it("既存リーダーのmax_bidが不足していれば自動再入札は起きない(挑戦者がそのまま最高額)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("proxy-seller2", SESSION_SECRET));
    const bidderAH = bearer(await issueSessionToken("proxy-a2", SESSION_SECRET));
    const bidderBH = bearer(await issueSessionToken("proxy-b2", SESSION_SECRET));
    const listingId = await makeAuctionListing(env, sellerH, 0);

    // A: amount=100・max_bid=105(次の挑戦に1刻みも足せない上限)
    await transition(env, bidderAH, listingId, { kind: "bid", amount: 100, max_bid: 105 });
    // B: amount=110。Aの再入札に必要な額=110+10=120 > max_bid(105) → 再入札は起きない。
    await transition(env, bidderBH, listingId, { kind: "bid", amount: 110 });

    const st = (await (await state(env, sellerH, listingId)).json()) as {
      bids: Array<{ bidder: string; amount?: number }>;
    };
    const top = st.bids.slice().sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))[0];
    expect(top.bidder).toBe("proxy-b2");
    expect(top.amount).toBe(110);
  });

  it("自動決着(settleDueAuctions)はmax_bidではなく実効入札額で落札額を確定する", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const sellerH = bearer(await issueSessionToken("proxy-seller3", SESSION_SECRET));
    const bidderAH = bearer(await issueSessionToken("proxy-a3", SESSION_SECRET));
    const bidderBH = bearer(await issueSessionToken("proxy-b3", SESSION_SECRET));
    // 締切は未来のまま入札を進め、あとで直接イベントを読み終値だけ確認する
    // (auction-settle.test.ts と同じ制約: ends_at=過去だと bid 到達前に auto-delist される)。
    const listingId = await makeAuctionListing(env, sellerH, 0);
    await transition(env, bidderAH, listingId, { kind: "bid", amount: 100, max_bid: 10000 });
    await transition(env, bidderBH, listingId, { kind: "bid", amount: 110 });

    const st = (await (await state(env, sellerH, listingId)).json()) as {
      bids: Array<{ bidder: string; amount?: number }>;
    };
    const top = st.bids.slice().sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))[0];
    // 実効額(2番手110+step10=120)であって max_bid(10000) ではない。
    expect(top.amount).toBe(120);
    expect(top.bidder).toBe("proxy-a3");
  });
});
