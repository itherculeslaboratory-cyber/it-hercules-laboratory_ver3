// V3-MKT-24 落札されなかった出品の自動再出品(値下げ方向のみ・下限価格で取り下げ)。
// w2-mktは「再出品ルールの宣言」+「次回価格計算」までを実装し、settleDueAuctionsから
// の自動発火配線は未接続のまま持ち越した(報告書R0731-13e96a §3)。w3-mktでこの配線
// (autoRelistIfDelisted・market-routes.ts)を接続したため、下の describe ブロックで
// 自動発火そのものを検証する。
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
function transition(env: object, headers: Record<string, string>, id: string, body: unknown) {
  return post(env, headers, `/market/listings/${id}/transition`, body);
}
function state(env: object, headers: Record<string, string>, id: string) {
  return app.request(`/api/v1/market/listings/${id}/state`, { headers }, env);
}
const PAST = "2020-01-01T00:00:00.000Z";

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

// V3-MKT-24(w3-mkt): settleDueAuctions の「入札なし→delist」枝からの自動発火配線。
describe("V3-MKT-24 自動発火(settleDueAuctionsからのautoRelistIfDelisted)", () => {
  it("relist-policy宣言済み+入札なしオークションは締切経過で値下げ後の新規listingが自動生成される", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("relist-auto1", SESSION_SECRET));
    const listingId = ((await (
      await post(env, sellerH, "/market/listings", { title: "自動再出品対象1", price: 1000, ends_at: PAST })
    ).json()) as { listing_id: string }).listing_id;
    await post(env, sellerH, `/market/listings/${listingId}/relist-policy`, {
      discount_mode: "percent",
      discount_value: 10,
    });
    await transition(env, sellerH, listingId, { kind: "list_auction" });

    const st = (await (await state(env, sellerH, listingId)).json()) as { state: string };
    expect(st.state).toBe("delisted"); // 元の出品自体は従来どおりdelist

    const listings = (await (await get(env, sellerH, "/market/listings")).json()) as {
      listings: { listing_id: string; title: string; price?: number }[];
    };
    const relisted = listings.listings.find((l) => l.listing_id !== listingId && l.title === "自動再出品対象1");
    expect(relisted?.price).toBe(900); // 1000の10%引き=900(nextRelistPriceと同じ計算式)
  });

  it("relist-policy未宣言のオークションは自動再出品しない(従来どおりdelistのみ)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("relist-auto2", SESSION_SECRET));
    const listingId = ((await (
      await post(env, sellerH, "/market/listings", { title: "自動再出品対象2(policy無し)", price: 1000, ends_at: PAST })
    ).json()) as { listing_id: string }).listing_id;
    await transition(env, sellerH, listingId, { kind: "list_auction" });

    await state(env, sellerH, listingId);
    const listings = (await (await get(env, sellerH, "/market/listings")).json()) as {
      listings: { listing_id: string; title: string }[];
    };
    const relisted = listings.listings.find((l) => l.listing_id !== listingId && l.title === "自動再出品対象2(policy無し)");
    expect(relisted).toBeUndefined();
  });

  it("下限価格を割る場合は再出品しない(元のdelistのみ・新規listingは作られない)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("relist-auto3", SESSION_SECRET));
    const listingId = ((await (
      await post(env, sellerH, "/market/listings", { title: "自動再出品対象3(下限到達)", price: 1000, ends_at: PAST })
    ).json()) as { listing_id: string }).listing_id;
    await post(env, sellerH, `/market/listings/${listingId}/relist-policy`, {
      discount_mode: "fixed",
      discount_value: 900,
      floor_price: 200,
    });
    await transition(env, sellerH, listingId, { kind: "list_auction" });

    await state(env, sellerH, listingId);
    const listings = (await (await get(env, sellerH, "/market/listings")).json()) as {
      listings: { listing_id: string; title: string }[];
    };
    const relisted = listings.listings.find((l) => l.listing_id !== listingId && l.title === "自動再出品対象3(下限到達)");
    expect(relisted).toBeUndefined();
  });

  it("自動再出品の発火は冪等(state二重読み出しでも新規listingは1件だけ)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("relist-auto4", SESSION_SECRET));
    const listingId = ((await (
      await post(env, sellerH, "/market/listings", { title: "自動再出品対象4(冪等)", price: 1000, ends_at: PAST })
    ).json()) as { listing_id: string }).listing_id;
    await post(env, sellerH, `/market/listings/${listingId}/relist-policy`, {
      discount_mode: "none",
    });
    await transition(env, sellerH, listingId, { kind: "list_auction" });

    await state(env, sellerH, listingId);
    await state(env, sellerH, listingId); // 二重読み出し

    const listings = (await (await get(env, sellerH, "/market/listings")).json()) as {
      listings: { listing_id: string; title: string }[];
    };
    const relistedCount = listings.listings.filter(
      (l) => l.listing_id !== listingId && l.title === "自動再出品対象4(冪等)",
    ).length;
    expect(relistedCount).toBe(1);
  });
});
