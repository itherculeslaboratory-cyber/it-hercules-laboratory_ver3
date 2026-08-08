// IDEA-0209(V3-MKT-05残要素・w3-07実装): 即決価格(buy_now_price)による即落札。
// この価格以上の入札(bid)はヤフオク型自動再入札・AUTOBID-1締切延長より優先して
// 即座に matched へ確定する(market-settlement.ts isBuyNowTrigger / market-routes.ts
// bid 分岐 buyNowTriggered)。
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
function transition(env: object, headers: Record<string, string>, id: string, body: unknown) {
  return post(env, headers, `/market/listings/${id}/transition`, body);
}
function state(env: object, headers: Record<string, string>, id: string) {
  return app.request(`/api/v1/market/listings/${id}/state`, { headers }, env);
}

async function makeAuctionListing(
  env: object,
  sellerH: Record<string, string>,
  opts: { endsAt: string; price?: number; buyNowPrice?: number },
) {
  const body: Record<string, unknown> = { title: "即決テスト", ends_at: opts.endsAt };
  if (opts.price !== undefined) body.price = opts.price;
  if (opts.buyNowPrice !== undefined) body.buy_now_price = opts.buyNowPrice;
  const listingId = ((await (await post(env, sellerH, "/market/listings", body)).json()) as {
    listing_id: string;
  }).listing_id;
  await transition(env, sellerH, listingId, { kind: "list_auction" });
  return listingId;
}

describe("IDEA-0209 即決価格(buy_now_price)による即落札(w3-07実装)", () => {
  it("即決成立: buy_now_price以上の入札は直後にmatchedへ確定し、延長機構は起動しない", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("bn-seller-hit", SESSION_SECRET));
    const bidderH = bearer(await issueSessionToken("bn-bidder-hit", SESSION_SECRET));
    const farEndsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1時間後(延長窓の外)
    const listingId = await makeAuctionListing(env, sellerH, { endsAt: farEndsAt, buyNowPrice: 500 });

    const res = await transition(env, bidderH, listingId, { kind: "bid", amount: 500 });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { state: string; stage: number };
    // レスポンス自体が即決による matched 確定を反映する(延長・自動再入札のような
    // 「別経路で後から反映される」非同期処理ではない=この入札の応答で完結する)。
    expect(body.state).toBe("matched");

    const st = (await (await state(env, sellerH, listingId)).json()) as {
      state: string;
      matched_with?: string;
      auction?: unknown;
    };
    expect(st.state).toBe("matched");
    expect(st.matched_with).toBe("bn-bidder-hit");
    // matched に確定した時点で auction ブロック(延長情報含む)は返らない
    // (cur.state !== "listed_auction" のため) = 延長機構が別途何か処理を続けている
    // 形跡が無いことの確認。
    expect(st.auction).toBeUndefined();
  });

  it("即決なし出品: buy_now_price未設定なら通常の入札のまま(listed_auctionを維持)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("bn-seller-none", SESSION_SECRET));
    const bidderH = bearer(await issueSessionToken("bn-bidder-none", SESSION_SECRET));
    const farEndsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const listingId = await makeAuctionListing(env, sellerH, { endsAt: farEndsAt });

    const res = await transition(env, bidderH, listingId, { kind: "bid", amount: 500 });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { state: string };
    expect(body.state).toBe("listed_auction");

    const st = (await (await state(env, sellerH, listingId)).json()) as {
      state: string;
      auction?: { buy_now_price?: number };
    };
    expect(st.state).toBe("listed_auction");
    expect(st.auction?.buy_now_price).toBeUndefined();
  });

  it("即決価格 < 現在最高額: 即決価格が開始価格(希望価格)を下回る設定では即決入札はBID_TOO_LOWで拒否される", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("bn-seller-low", SESSION_SECRET));
    const bidderH = bearer(await issueSessionToken("bn-bidder-low", SESSION_SECRET));
    const farEndsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    // 希望価格(開始価格)1000円 > 即決価格300円という(出品者の設定ミスに相当する)状況。
    const listingId = await makeAuctionListing(env, sellerH, { endsAt: farEndsAt, price: 1000, buyNowPrice: 300 });

    // 即決ボタンは amount=buy_now_price(=300) を送るが、現在価格(1000)+刻みに満たないため
    // 通常の BID_TOO_LOW として拒否される(buyNowTriggered は amount>=nextMinBid も要求する)。
    const res = await transition(env, bidderH, listingId, { kind: "bid", amount: 300 });
    expect(res.status).toBe(409);
    const errBody = (await res.json()) as { error: string; min_next_bid?: number };
    expect(errBody.error).toBe("BID_TOO_LOW");
    expect(errBody.min_next_bid).toBeGreaterThan(300);

    const st = (await (await state(env, sellerH, listingId)).json()) as { state: string };
    expect(st.state).toBe("listed_auction"); // 拒否されたので出品は動いていない
  });
});
