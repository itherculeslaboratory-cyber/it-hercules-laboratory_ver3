import { test, expect, request, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { makePng } from "./make-png";

// C8 UI レビューシート用スクショ(HANDOFF §7 DoD-3)。受領10で60点だった3画面
// (market-trade-detail / market-trade-browse / knowledge-thread)を、UI磨き
// 第2弾(受領10)の実データ入り状態で撮り直す。空状態のc8-full-sweepと違い、
// ここは market-trade-lifecycle.spec.ts / knowledge-thread.spec.ts と同じ実
// シードで #1(when役割出し分け)・#2(出品写真=image-grid実サムネ)・#3(kebab
// 折り畳み)・#5(actor表示名)・#6(投稿ごと賛否ボタン)を実際に踏んだ状態にする。

const API = "http://127.0.0.1:8787";
const WEB = "http://127.0.0.1:3000";
const SPEC_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SPEC_DIR, "..", "..", "..");
const SHOTS = resolve(REPO_ROOT, "docs", "planning", "c8", "screens");

async function devLogin(page: Page): Promise<void> {
  await page.goto(`${WEB}/s/login`);
  await page.getByRole("button", { name: "開発トークンでログイン" }).click();
  await expect(page.getByRole("heading", { name: "観測ホーム" })).toBeVisible();
}

// market-trade-lifecycle.spec.ts と同型(2nd real actor via magic-link verify)。
async function secondActorPage(browser: Browser, email: string): Promise<Page> {
  const anon: APIRequestContext = await request.newContext({ baseURL: API });
  const mlRes = await anon.post("/api/v1/auth/magic-link", { data: { email } });
  expect(mlRes.status()).toBe(202);
  const ml = (await mlRes.json()) as { dev_magic_token: string };
  const verifyRes = await anon.post("/api/v1/auth/verify", { data: { token: ml.dev_magic_token } });
  expect(verifyRes.status()).toBe(200);
  const setCookie = verifyRes.headersArray().find((h) => h.name.toLowerCase() === "set-cookie");
  expect(setCookie, "verify must Set-Cookie ihl_session").toBeTruthy();
  const sessionToken = setCookie!.value.split(";")[0].slice("ihl_session=".length);
  await anon.patch("/api/v1/me/preferences", {
    headers: { cookie: `ihl_session=${sessionToken}` },
    data: { handle: "e2e-shot-buyer", locale: "ja" },
  });
  await anon.dispose();
  const context = await browser.newContext();
  await context.addCookies([{ name: "ihl_session", value: sessionToken, url: WEB, httpOnly: true, sameSite: "Lax" }]);
  return context.newPage();
}

function waitForKind(p: Page, kind: string) {
  return p.waitForURL((url) => url.searchParams.get("kind") === kind);
}

// 1440(desktop)→390(mobile)の順で同じDOM状態を2幅撮る(reload不要・CSSの
// レスポンシブ切替のみで反映される。civ-table<=560pxカードリスト化(#7)も
// この方式で両幅とも正しく検証できる)。撮影後は1440へ戻し、後続操作を
// デスクトップ基準で続けられるようにする。
async function shotBothWidths(page: Page, name: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: resolve(SHOTS, `${name}-1440.png`), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(SHOTS, `${name}-390.png`), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
}

test("market-trade: browse(実サムネ) + detail(買い手/売り手when出し分け)", async ({ page, browser }) => {
  await devLogin(page); // seller = dev@ihl.local

  await page.goto(`${WEB}/s/market-trade`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("tab", { name: "出品する" }).click();
  const title = `UIレビュー出品 ${Date.now().toString(36)}`;
  await page.getByLabel("出品タイトル *").fill(title);
  await page.getByLabel(/個体写真/).setInputFiles({ name: "e2e-shot.png", mimeType: "image/png", buffer: makePng() });
  await page.getByLabel("希望価格(円・任意)").fill("12000");
  await page.getByRole("button", { name: "下書きを作成する" }).click();
  await page.waitForURL(/listing_id=/);
  await page.waitForLoadState("networkidle");
  const listingId = new URL(page.url()).searchParams.get("listing_id");
  expect(listingId).toBeTruthy();

  await page.getByRole("button", { name: "この出品を公開する(未出品→公開・即決既定)" }).click();
  await waitForKind(page, "list_fixed");
  await page.waitForLoadState("networkidle");

  // browse: 「買う」タブの image-grid に実サムネ(#2)が乗った状態を撮る。
  await page.goto(`${WEB}/s/market-trade`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("tab", { name: "買う" }).click();
  await expect(page.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  await shotBothWidths(page, "market-trade-browse");

  // detail: 買い手が申込み、取引ボード(成立後)で買い手専用ボタンだけが見える
  // 状態(#1 when役割出し分け)を撮る。
  const buyer = await secondActorPage(browser, `e2e-shot-buyer-${Date.now().toString(36)}@ihl.local`);
  await buyer.setViewportSize({ width: 1440, height: 900 });
  await buyer.goto(`${WEB}/s/market-trade?listing_id=${listingId}`);
  await expect(buyer.getByText(`${title} / 12000 円`)).toBeVisible();
  await buyer.getByRole("button", { name: "この出品に申込む(即決=申込確定で成立)" }).click();
  await waitForKind(buyer, "match");
  await buyer.waitForLoadState("networkidle");
  await buyer.getByRole("tab", { name: "取引ボード(成立後)" }).click();
  await expect(buyer.getByRole("button", { name: "振込済みを申告する(買い手)" })).toBeVisible();
  await expect(buyer.getByRole("button", { name: "入金を確認した(出品者)" })).not.toBeVisible();
  await shotBothWidths(buyer, "market-trade-detail");
});

test("knowledge-thread: グループチャット(吹き出し表示+チャット送信) — KNW wave1 stage2再設計", async ({ page }) => {
  // R94「既存を捨てる」: 旧 thread-posts(投稿ごと賛否/kebab/解決マーク)は撤去され、
  // このスクリーンは KnowledgeThreadChatNode(グループチャット)へ一本化された。
  // 撮影用に seed 投稿→吹き出し描画→チャット送信までを新設計で通す。
  await devLogin(page);

  const threadId = `ui-review-thr-${Date.now().toString(36)}`;
  const post = await page.evaluate(async (tid) => {
    const r = await fetch("/api/v1/plaza/posts", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        thread_id: tid,
        channel: "knowledge-board",
        topic: "UIレビュー用スレ",
        board_kind: "guide",
        body: "UIレビュー撮影用の初期投稿です",
      }),
    });
    return { status: r.status, json: await r.json() };
  }, threadId);
  expect(post.status).toBe(201);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${WEB}/s/knowledge-thread?thread_id=${threadId}`);
  await page.waitForLoadState("networkidle");

  // seed 投稿がチャット吹き出しとして描画される。
  await expect(page.locator(".msg", { hasText: "UIレビュー撮影用の初期投稿です" })).toBeVisible();

  // 新設計に旧UI(投稿ごと賛否/解決マーク)が無いことを固定。
  await expect(page.getByRole("button", { name: "賛成" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "✔ 解決済みにする" })).toHaveCount(0);

  // チャット入力欄から送信 → 送信後の再フェッチで吹き出しが増える。
  const input = page.getByPlaceholder("メッセージを送る…");
  await input.fill("これはUIレビュー撮影用のチャット送信です");
  await page.getByRole("button", { name: "送信" }).click();
  await expect(page.locator(".msg", { hasText: "これはUIレビュー撮影用のチャット送信です" })).toBeVisible();

  await shotBothWidths(page, "knowledge-thread");
});
