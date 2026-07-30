// V3-MKT-52 マーケット検索/フィルタAPI: cursor-based pagination + limit軽量化 +
// 文化タグ(lang)配列検索。GET /market/listings に ?cursor=/?limit=/?lang= を追加。
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
function get(env: object, headers: Record<string, string>, path: string) {
  return app.request(`/api/v1${path}`, { headers }, env);
}

describe("V3-MKT-52 検索/フィルタAPI(cursor pagination)", () => {
  it("limitで件数を絞り、next_cursorで続きを取れる", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("pag-seller1", SESSION_SECRET));
    for (let i = 0; i < 5; i++) {
      await post(env, sellerH, "/market/listings", { title: `出品${i}` });
    }
    const page1 = (await (await get(env, sellerH, "/market/listings?limit=2")).json()) as {
      listings: { listing_id: string }[];
      next_cursor?: string;
    };
    expect(page1.listings.length).toBe(2);
    expect(page1.next_cursor).toBeDefined();

    const page2 = (await (await get(env, sellerH, `/market/listings?limit=2&cursor=${page1.next_cursor}`)).json()) as {
      listings: { listing_id: string }[];
    };
    expect(page2.listings.length).toBe(2);
    // 重複なし(1ページ目と2ページ目でIDが被らない)
    const ids1 = page1.listings.map((l) => l.listing_id);
    const ids2 = page2.listings.map((l) => l.listing_id);
    expect(ids1.some((id) => ids2.includes(id))).toBe(false);
  });

  it("既定limit(50)未満の件数なら次カーソルは無い", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("pag-seller2", SESSION_SECRET));
    await post(env, sellerH, "/market/listings", { title: "単発出品" });
    const page = (await (await get(env, sellerH, "/market/listings")).json()) as { next_cursor?: string };
    expect(page.next_cursor).toBeUndefined();
  });
});
