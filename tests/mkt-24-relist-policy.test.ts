// V3-MKT-24 落札されなかった出品の自動再出品(値下げ方向のみ・下限価格で取り下げ)。
// このテストは「再出品ルールの宣言」+「次回価格計算」までを検証する(自動発火
// (settleDueAuctions からの自動 relist)は報告書に明記のとおり本波未接続=残作業)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { nextRelistPrice } from "../apps/api/src/market-settlement";
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

describe("V3-MKT-24 純関数: nextRelistPrice(値下げ方向のみ)", () => {
  it("percent値下げは切り捨てで計算する", () => {
    expect(nextRelistPrice(1000, { maxRelistCount: null, discountMode: "percent", discountValue: 10, floorPrice: null })).toBe(900);
  });
  it("fixed値下げは固定額を引く", () => {
    expect(nextRelistPrice(1000, { maxRelistCount: null, discountMode: "fixed", discountValue: 300, floorPrice: null })).toBe(700);
  });
  it("noneは同額のまま(価格を上げる自動調整はしない)", () => {
    expect(nextRelistPrice(1000, { maxRelistCount: null, discountMode: "none", discountValue: 0, floorPrice: null })).toBe(1000);
  });
  it("下限価格を割る場合はnull(最低額で取り下げ)", () => {
    expect(nextRelistPrice(1000, { maxRelistCount: null, discountMode: "fixed", discountValue: 900, floorPrice: 200 })).toBe(null);
  });
});

describe("V3-MKT-24 再出品ルールの宣言(POST/GET relist-policy)", () => {
  it("出品者以外の宣言は403", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("relist-seller1", SESSION_SECRET));
    const otherH = bearer(await issueSessionToken("relist-other1", SESSION_SECRET));
    const listingId = ((await (await post(env, sellerH, "/market/listings", { title: "再出品対象" })).json()) as {
      listing_id: string;
    }).listing_id;
    const res = await post(env, otherH, `/market/listings/${listingId}/relist-policy`, { discount_mode: "percent", discount_value: 10 });
    expect(res.status).toBe(403);
  });

  it("宣言後GETで現在価格からの次回再出品価格プレビューが取れる", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("relist-seller2", SESSION_SECRET));
    const listingId = ((await (await post(env, sellerH, "/market/listings", { title: "再出品対象2", price: 1000 })).json()) as {
      listing_id: string;
    }).listing_id;
    const created = await post(env, sellerH, `/market/listings/${listingId}/relist-policy`, {
      max_relist_count: 3,
      discount_mode: "percent",
      discount_value: 10,
      floor_price: 500,
    });
    expect(created.status).toBe(201);

    const preview = (await (await get(env, sellerH, `/market/listings/${listingId}/relist-policy`)).json()) as {
      current_price: number;
      next_relist_price: number | null;
    };
    expect(preview.current_price).toBe(1000);
    expect(preview.next_relist_price).toBe(900);
  });

  it("2回目の宣言は409(訂正は本波スコープ外)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("relist-seller3", SESSION_SECRET));
    const listingId = ((await (await post(env, sellerH, "/market/listings", { title: "再出品対象3" })).json()) as {
      listing_id: string;
    }).listing_id;
    await post(env, sellerH, `/market/listings/${listingId}/relist-policy`, { discount_mode: "none" });
    const second = await post(env, sellerH, `/market/listings/${listingId}/relist-policy`, { discount_mode: "none" });
    expect(second.status).toBe(409);
  });
});
