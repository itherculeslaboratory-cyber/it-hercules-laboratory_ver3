// c8 UI磨き第2弾#2(受領10「画像がない」) — mkt-listing-photo(ihl.mkt.listing_photo.v1)
// 出品写真: 出品者のみアップロード可(403 else)・detail の photos[]・一覧の
// cover_photo_id(先頭1枚)・GET blob(404/200・content-type往復)を検証。
// 既存 mkt-listing 型は無変更(POST /market/listings の title/price 動作は market.test.ts が
// 引き続き担保する・本ファイルは写真イベント側のみ)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}
function jsonHeaders(h: Record<string, string>) {
  return { ...h, "content-type": "application/json" };
}

async function createListing(env: object, headers: Record<string, string>): Promise<string> {
  const res = await app.request(
    "/api/v1/market/listings",
    { method: "POST", headers: jsonHeaders(headers), body: JSON.stringify({ title: "写真つき出品" }) },
    env,
  );
  const { listing_id } = (await res.json()) as { listing_id: string };
  return listing_id;
}

function uploadPhoto(env: object, headers: Record<string, string>, listingId: string, bytes: Uint8Array, type = "image/png") {
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type }), "photo.png");
  // multipart body needs its own boundary content-type — drop the JSON header
  // (matches tests/cl-07-thumbnail-pipeline.test.ts's observation/upload TC).
  const { Authorization } = headers;
  return app.request(`/api/v1/market/listings/${listingId}/photo`, { method: "POST", headers: { Authorization }, body: fd }, env);
}

describe("POST /api/v1/market/listings/{id}/photo", () => {
  it("出品者本人がアップロード→detail の photos[] に載る", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("seller-1", SESSION_SECRET));
    const listingId = await createListing(env, sellerH);

    const up = await uploadPhoto(env, sellerH, listingId, new Uint8Array([1, 2, 3, 4]));
    expect(up.status).toBe(202);
    const { photo_id } = (await up.json()) as { photo_id: string };
    expect(photo_id).toBeTruthy();

    const detail = (await (await app.request(`/api/v1/market/listings/${listingId}`, { headers: sellerH }, env)).json()) as {
      photos: Array<{ photo_id: string }>;
    };
    expect(detail.photos.map((p) => p.photo_id)).toContain(photo_id);
  });

  it("出品者以外は403", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("seller-2", SESSION_SECRET));
    const otherH = bearer(await issueSessionToken("other-2", SESSION_SECRET));
    const listingId = await createListing(env, sellerH);

    const up = await uploadPhoto(env, otherH, listingId, new Uint8Array([9, 9]));
    expect(up.status).toBe(403);
  });

  it("存在しない listing_id → 404", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("seller-3", SESSION_SECRET));
    const up = await uploadPhoto(env, sellerH, "nope", new Uint8Array([1]));
    expect(up.status).toBe(404);
  });

  it("一覧の cover_photo_id は先頭アップロードを指す(写真無し出品は cover_photo_id 自体が現れない)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("seller-4", SESSION_SECRET));
    const withPhoto = await createListing(env, sellerH);
    const withoutPhoto = await createListing(env, sellerH);
    await uploadPhoto(env, sellerH, withPhoto, new Uint8Array([1, 2]));

    const listed = (await (await app.request("/api/v1/market/listings", { headers: sellerH }, env)).json()) as {
      listings: Array<Record<string, unknown>>;
    };
    const a = listed.listings.find((l) => l.listing_id === withPhoto)!;
    const b = listed.listings.find((l) => l.listing_id === withoutPhoto)!;
    expect(typeof a.cover_photo_id).toBe("string");
    expect("cover_photo_id" in b).toBe(false);
  });

  it("GET photo blob: 200 でバイト列+content-type 往復・未知 photo_id は404", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("seller-5", SESSION_SECRET));
    const listingId = await createListing(env, sellerH);
    const bytes = new Uint8Array([5, 6, 7, 8, 9]);
    const up = await uploadPhoto(env, sellerH, listingId, bytes, "image/png");
    const { photo_id } = (await up.json()) as { photo_id: string };

    const got = await app.request(`/api/v1/market/listings/${listingId}/photo/${photo_id}`, { headers: sellerH }, env);
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);

    const missing = await app.request(`/api/v1/market/listings/${listingId}/photo/nope`, { headers: sellerH }, env);
    expect(missing.status).toBe(404);
  });
});
