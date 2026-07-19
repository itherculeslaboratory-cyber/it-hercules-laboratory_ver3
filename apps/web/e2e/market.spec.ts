import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

// V3-AIP-49 / C7-T1 — market 実 UI + 実バックエンド E2E. observation.spec の作法:
// in-screen dev-login（HttpOnly セッション cookie が Next rewrite 経由で same-origin
// に流れる）→ ScreenDef Renderer が REAL market-trade を描画 → 出品→一覧→詳細 を実
// worker + R2-local（wrangler dev local = メモリ R2 = E2E FakeR2）に対して通貫。
//
// なぜ出品フローが同一オリジン fetch 駆動か（誠実な記録・モックではない）: 出品 create-form
// を宣言する market screen-def は存在しないため、出品→一覧→詳細 は UI が叩くのと同一の
// same-origin cookie で REAL /api/v1/market/* を直接駆動する。C7-T2 で market-trade の
// source_path を {{params.listing_id}} に統一し（旧 {listing_id} 単一波括弧は Renderer が
// 埋めなかった）+ 詳細カードに card bind_text を実装したので、末尾で listing_id 付き URL を
// 開き、詳細カードが title/price を画面に描くことも実測する。
//
// 依存ゲート解除: market-trade.json は C5 で恒久存在（navigation.json 収録）。旧 skip
// （K3 未産出待ち）は解消済み。

const WEB = "http://127.0.0.1:3000";
const SPEC_DIR = dirname(fileURLToPath(import.meta.url));
const MARKET_DEF = resolve(SPEC_DIR, "..", "..", "..", "screen-defs", "market-trade.json");

async function devLogin(page: Page): Promise<void> {
  await page.goto(`${WEB}/s/login`);
  await page.getByRole("button", { name: "開発トークンでログイン" }).click();
  await expect(page.getByRole("heading", { name: "ホーム" })).toBeVisible();
}

// same-origin authenticated fetch (browser cookie jar). credentials:"include"
// so the HttpOnly session authenticates exactly as the UI's own fetches do.
async function api(page: Page, method: string, path: string, body?: unknown) {
  return page.evaluate(
    async ([m, p, b]) => {
      const init: RequestInit = { method: m as string, credentials: "include" };
      if (b != null) {
        init.headers = { "content-type": "application/json" };
        init.body = JSON.stringify(b);
      }
      const r = await fetch(p as string, init);
      return { status: r.status, json: await r.json().catch(() => null) };
    },
    [method, path, body ?? null] as const,
  );
}

test("market lifecycle: dev-login, publish, list, detail through the real worker", async ({ page }) => {
  expect(existsSync(MARKET_DEF), "market-trade.json must exist (C5 dependency)").toBe(true);

  await devLogin(page);

  // 実 UI: the Renderer draws the REAL market-trade screen-def (heading proves it
  // renders through the live catalog, not a mock).
  await page.goto(`${WEB}/s/market-trade`);
  await expect(page.getByRole("heading", { name: "取引", level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");

  const stamp = Date.now().toString(36);
  const title = `E2E listing ${stamp}`;

  // 出品: append a listing to real Truth (201).
  const created = await api(page, "POST", "/api/v1/market/listings", { title, price: 1200 });
  expect(created.status, "publish must be 201").toBe(201);
  const listingId = (created.json as { listing_id: string }).listing_id;
  expect(listingId, "publish returns a listing_id").toBeTruthy();

  // 一覧: the projection (R2 prefix scan) now includes this listing.
  const listed = await api(page, "GET", "/api/v1/market/listings");
  expect(listed.status).toBe(200);
  const listings = (listed.json as { listings: Array<{ listing_id: string; title: string }> }).listings;
  const mine = listings.find((l) => l.listing_id === listingId);
  expect(mine, "listing appears in the list projection").toBeTruthy();
  expect(mine!.title).toBe(title);

  // 詳細: the single-listing projection round-trips the same persisted record,
  // with actor_id stamped by the session principal (V3-AUT-17).
  const detail = await api(page, "GET", `/api/v1/market/listings/${listingId}`);
  expect(detail.status).toBe(200);
  const listing = (detail.json as { listing: { title: string; price: number; actor_id: string } }).listing;
  expect(listing.title).toBe(title);
  expect(listing.price).toBe(1200);
  expect(typeof listing.actor_id).toBe("string");

  // カード値描画の可視 assert: listing_id を渡して screen を開くと、詳細カードが
  // bind_text で REAL /market/listings/{id} の title/price を画面テキストに描く
  // （C7-T2 の card bind_text 実装 + source_path の {{params.listing_id}} 統一の実証）。
  await page.goto(`${WEB}/s/market-trade?listing_id=${listingId}`);
  await expect(page.getByText(`${title} / 1200 円`)).toBeVisible();
});
