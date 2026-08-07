// AUTOBID-1(w2-market2実装・review-queue R0807-1ef084 AUTOBID-1=○ score90「必須!これが
// ないと楽しくない」)。終了間際(残りAUCTION_EXTEND_WINDOW_MINUTES分以内)の入札で締切を
// 「今からAUCTION_EXTEND_BY_MINUTES分後」まで延長するスナイプ防止。ifYes文どおり延長は
// txn台帳へ追記のみ(listing.ends_atは書き換えない・effectiveAuctionEndsAtが実効締切を
// 都度再計算する)。上限回数(AUCTION_EXTEND_MAX_COUNT)は本ラウンドで置いた既定値
// (economy-constants.ts参照・判断が要った箇所)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { AUCTION_EXTEND_BY_MINUTES, AUCTION_EXTEND_MAX_COUNT } from "../apps/api/src/economy-constants";
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

async function makeAuctionListing(env: object, sellerH: Record<string, string>, endsAt: string) {
  const listingId = ((await (
    await post(env, sellerH, "/market/listings", { title: "延長テスト", ends_at: endsAt })
  ).json()) as { listing_id: string }).listing_id;
  await transition(env, sellerH, listingId, { kind: "list_auction" });
  return listingId;
}

describe("AUTOBID-1 終了間際の入札で締切を自動延長(review-queue R0807-1ef084 ○ score90)", () => {
  it("延長しないケース: 残り5分超の入札は締切を動かさない", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("ext-seller-far", SESSION_SECRET));
    const bidderH = bearer(await issueSessionToken("ext-bidder-far", SESSION_SECRET));
    const farEndsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1時間後
    const listingId = await makeAuctionListing(env, sellerH, farEndsAt);

    const res = await transition(env, bidderH, listingId, { kind: "bid", amount: 10 });
    expect(res.status).toBe(201);

    const st = (await (await state(env, sellerH, listingId)).json()) as {
      auction?: { ends_at?: string; extended?: boolean; extension_count?: number };
    };
    expect(st.auction?.extended).toBe(false);
    expect(st.auction?.extension_count).toBe(0);
    expect(st.auction?.ends_at).toBe(farEndsAt);
  });

  it("延長するケース: 残り5分以内の入札で締切が「今から5分後」まで押し出される", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("ext-seller-near", SESSION_SECRET));
    const bidderH = bearer(await issueSessionToken("ext-bidder-near", SESSION_SECRET));
    const nearEndsAt = new Date(Date.now() + 2 * 60 * 1000).toISOString(); // 2分後(窓=5分以内)
    const listingId = await makeAuctionListing(env, sellerH, nearEndsAt);

    const before = Date.now();
    const res = await transition(env, bidderH, listingId, { kind: "bid", amount: 10 });
    expect(res.status).toBe(201);

    const st = (await (await state(env, sellerH, listingId)).json()) as {
      auction?: { ends_at?: string; extended?: boolean; extension_count?: number };
    };
    expect(st.auction?.extended).toBe(true);
    expect(st.auction?.extension_count).toBe(1);
    const newEndsAtMs = new Date(st.auction?.ends_at as string).getTime();
    expect(newEndsAtMs).toBeGreaterThan(new Date(nearEndsAt).getTime());
    // 「今から5分後」まで押し出されている(±5秒の実行誤差を許容)。
    expect(newEndsAtMs).toBeGreaterThanOrEqual(before + AUCTION_EXTEND_BY_MINUTES * 60 * 1000 - 5000);
  });

  it("延長は上限回数(AUCTION_EXTEND_MAX_COUNT)で頭打ちになる(ifYes文(c)の既定値)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("ext-seller-cap", SESSION_SECRET));
    const bidderH = bearer(await issueSessionToken("ext-bidder-cap", SESSION_SECRET));
    const nearEndsAt = new Date(Date.now() + 1 * 60 * 1000).toISOString(); // 1分後
    const listingId = await makeAuctionListing(env, sellerH, nearEndsAt);

    // 延長のたびに実効締切が「今から5分後」へ押し出されるため、直後の次の入札も
    // 毎回窓内に入り続け、上限に達するまで延長し続ける(同一入札者の連続入札=規約上禁止されていない)。
    for (let i = 1; i <= AUCTION_EXTEND_MAX_COUNT + 3; i++) {
      const res = await transition(env, bidderH, listingId, { kind: "bid", amount: i * 10 });
      expect(res.status).toBe(201);
    }

    const st = (await (await state(env, sellerH, listingId)).json()) as {
      auction?: { extension_count?: number };
    };
    expect(st.auction?.extension_count).toBe(AUCTION_EXTEND_MAX_COUNT);
  });
});
