// V3-MKT-21 国際配送・通関(from×to 2次元・R2 JSON・海外発送は標本(乾燥個体)のみ・
// 全画面で本体価格+推定送料=総額を表示)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { marketIntlShippingRoutes } from "../apps/api/src/market-intl-shipping-routes";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

// index.ts の mount 行(app.route("/api/v1", marketIntlShippingRoutes))は艦が直接
// 書かず、報告書に挿入位置を明記してHQが検収時に適用する(KIT-TEMPLATE §7)。この
// テストは import した app インスタンスへ実行時にだけ同じ route を追加してハンドラ
// 本体を検証する(index.ts ファイル自体は変更しない・本番の未マウント状態は変えない)。
app.route("/api/v1", marketIntlShippingRoutes);

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}
function post(env: object, headers: Record<string, string>, path: string, body: unknown) {
  return app.request(`/api/v1${path}`, { method: "POST", headers, body: JSON.stringify(body) }, env);
}
function patch(env: object, headers: Record<string, string>, path: string, body: unknown) {
  return app.request(`/api/v1${path}`, { method: "PATCH", headers, body: JSON.stringify(body) }, env);
}
function get(env: object, headers: Record<string, string>, path: string) {
  return app.request(`/api/v1${path}`, { headers }, env);
}

async function createListing(env: object, headers: Record<string, string>, title: string, price?: number) {
  const res = await post(env, headers, "/market/listings", { title, ...(price !== undefined ? { price } : {}) });
  return ((await res.json()) as { listing_id: string }).listing_id;
}

describe("V3-MKT-21 国際配送・通関", () => {
  it("生体(specimen_dried省略)の国際発送宣言は400(INTL_LIVE_FORBIDDEN)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("intl-seller1", SESSION_SECRET));
    const listingId = await createListing(env, sellerH, "国際出品");
    const res = await post(env, sellerH, `/market/listings/${listingId}/intl`, { ships_from: "JP" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("INTL_LIVE_FORBIDDEN");
  });

  it("標本(specimen_dried=true)の国際発送宣言は201", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("intl-seller2", SESSION_SECRET));
    const listingId = await createListing(env, sellerH, "国際出品(標本)", 1000);
    const res = await post(env, sellerH, `/market/listings/${listingId}/intl`, { ships_from: "JP", specimen_dried: true });
    expect(res.status).toBe(201);
  });

  it("出品者以外の国際発送宣言は403", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("intl-seller2b", SESSION_SECRET));
    const otherH = bearer(await issueSessionToken("intl-other2b", SESSION_SECRET));
    const listingId = await createListing(env, sellerH, "国際出品(標本)", 1000);
    const res = await post(env, otherH, `/market/listings/${listingId}/intl`, { ships_from: "JP", specimen_dried: true });
    expect(res.status).toBe(403);
  });

  it("from×toの料金表を登録・参照できる(2次元構造)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const adminH = bearer(await issueSessionToken("intl-admin1", SESSION_SECRET));
    const created = await post(env, adminH, "/market/intl-shipping/rates", {
      from: "JP",
      to: "US",
      price_yen: 3000,
      customs_note: "乾燥標本は要HSコード申告",
      hs_code: "0106.49",
    });
    expect(created.status).toBe(201);
    const fetched = await get(env, adminH, "/market/intl-shipping/rates?from=JP&to=US");
    expect(fetched.status).toBe(200);
    const body = (await fetched.json()) as { price_yen: number; customs_note?: string };
    expect(body.price_yen).toBe(3000);
    expect(body.customs_note).toBe("乾燥標本は要HSコード申告");
  });

  it("総額=本体価格+推定送料(買い手の国が送り国と異なる場合)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("intl-seller3", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("intl-buyer3", SESSION_SECRET));
    await post(env, buyerH, "/market/intl-shipping/rates", { from: "JP", to: "US", price_yen: 2500 });
    await patch(env, buyerH, "/me/preferences", { country: "US" });
    const listingId = await createListing(env, sellerH, "国際出品(標本・総額計算)", 10000);
    await post(env, sellerH, `/market/listings/${listingId}/intl`, { ships_from: "JP", specimen_dried: true });

    const total = await get(env, buyerH, `/market/listings/${listingId}/total-price`);
    const body = (await total.json()) as { price: number; estimated_shipping_yen: number; total_price: number; international: boolean };
    expect(body.price).toBe(10000);
    expect(body.estimated_shipping_yen).toBe(2500);
    expect(body.total_price).toBe(12500);
    expect(body.international).toBe(true);
  });

  it("買い手の国が送り国と同じ(または未設定)なら送料0・international=false", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("intl-seller4", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("intl-buyer4", SESSION_SECRET));
    const listingId = await createListing(env, sellerH, "国内出品", 5000);

    const total = await get(env, buyerH, `/market/listings/${listingId}/total-price`);
    const body = (await total.json()) as { total_price: number; international: boolean };
    expect(body.total_price).toBe(5000);
    expect(body.international).toBe(false);
  });
});
