import { test, expect, request, type APIRequestContext, type Browser, type Page } from "@playwright/test";

// c8(ui-asset-catalog.md 【最優先1】)再構築版 — market-trade の主要動線を
// 実UI・実バックエンド・実2当事者で通貫: 出品(下書き作成→公開)→申込(即決=
// 成立)→振込済み申告→入金確認→発送→受取確定。GMO振込tableは round-16 決済
// 裁定で廃止済み(銀行振込P2P・IHL非関与)のため、この4トグル(pay_declare→
// pay_confirm→ship→receive)が正本の操作遷移(round-16裁定どおり)。
//
// 買い手/出品者は別 actor が必要 — observation.spec.ts の magic-link 実
// パターン(dev-login の1アカウント固定を避ける)を second actor 用に転用し、
// 2つ目の BrowserContext に実セッション cookie を注入して「同じ画面をUIで
// 実際にクリックする買い手」を作る(fetchだけのなりすましにしない)。
//
// 各遷移ボタンは POST 成功後に自己navigate(window.location.assign)で再読込
// する設計(renderer.tsx useRunAction)— navigate() 自体は POST 完了後の非同期
// 呼び出しなので、クリック直後に一発読みの page.url()/waitForLoadState だけに
// 頼ると「まだ遷移が始まっていない旧ページ」を掴むレースになる。static に
// 積んだ kind をクエリで待つ(page.waitForURL)ことで実際の再読込完了を確認する。

const API = "http://127.0.0.1:8787";
const WEB = "http://127.0.0.1:3000";

async function devLogin(page: Page): Promise<void> {
  await page.goto(`${WEB}/s/login`);
  await page.getByRole("button", { name: "開発トークンでログイン" }).click();
  await expect(page.getByRole("heading", { name: "観測ホーム" })).toBeVisible();
}

// A 2nd real actor's browser context, authenticated via the SAME magic-link
// verify flow observation.spec.ts's API-semantics suite already exercises —
// the Set-Cookie session token is injected into a fresh BrowserContext so the
// buyer drives the real Renderer UI (not a bare fetch impersonation).
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
  // V3-AUT-10 onboarding gate: a brand-new actor has no handle yet, so
  // apps/web/middleware.ts 307s every /s/* visit to /s/setup-profile before
  // the buyer ever reaches market-trade. Complete the same handle+locale
  // PATCH a real onboarding submission would (mirrors the seed auth-routes.ts
  // already does for the dev-login seller — see /dev-login there).
  await anon.patch("/api/v1/me/preferences", {
    headers: { cookie: `ihl_session=${sessionToken}` },
    data: { handle: "e2e-buyer", locale: "ja" },
  });
  await anon.dispose();

  const context = await browser.newContext();
  await context.addCookies([{ name: "ihl_session", value: sessionToken, url: WEB, httpOnly: true, sameSite: "Lax" }]);
  return context.newPage();
}

function waitForKind(p: Page, kind: string) {
  return p.waitForURL((url) => url.searchParams.get("kind") === kind);
}

test("market-trade lifecycle via real UI, 2 actors: draft -> publish -> apply(match) -> pay_declare -> pay_confirm -> ship -> receive", async ({
  page,
  browser,
}) => {
  await devLogin(page); // seller = dev@ihl.local

  // 1. 出品する — real create form (c8 new "出品する" tab), not a raw fetch.
  await page.goto(`${WEB}/s/market-trade`);
  await expect(page.getByRole("heading", { name: "取引", level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByRole("tab", { name: "出品する" }).click();
  const title = `E2E lifecycle ${Date.now().toString(36)}`;
  await page.getByLabel("出品タイトル *").fill(title);
  await page.getByLabel("希望価格(円・任意)").fill("12000");
  await page.getByRole("button", { name: "下書きを作成する" }).click();

  // create-listing-form self-navigates back here with listing_id on the query.
  await page.waitForURL(/listing_id=/);
  await page.waitForLoadState("networkidle");
  const listingId = new URL(page.url()).searchParams.get("listing_id");
  expect(listingId, "create must round-trip listing_id via the query").toBeTruthy();
  // "この出品/取引" is the default tab — the detail card is visible with no
  // extra click, same as the pre-c8 screen-def's contract (market.spec.ts).
  await expect(page.getByText(`${title} / 12000 円`)).toBeVisible();
  await expect(page.getByText(/状態 unlisted/)).toBeVisible();

  // 2. 公開する(list_fixed transition) — self-navigates + refetches state.
  await page.getByRole("button", { name: "この出品を公開する(未出品→公開・即決既定)" }).click();
  await waitForKind(page, "list_fixed");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/状態 listed_fixed/)).toBeVisible();

  // 3. 買い手が申込む(即決=申込確定で成立) — 2nd real actor, real UI click.
  const buyer = await secondActorPage(browser, `e2e-buyer-${Date.now().toString(36)}@ihl.local`);
  await buyer.goto(`${WEB}/s/market-trade?listing_id=${listingId}`);
  await expect(buyer.getByText(`${title} / 12000 円`)).toBeVisible();
  await buyer.getByRole("button", { name: "この出品に申込む(即決=申込確定で成立)" }).click();
  await waitForKind(buyer, "match");
  await buyer.waitForLoadState("networkidle");
  await expect(buyer.getByText(/状態 matched/)).toBeVisible();

  // 4. 振込済みを申告する(買い手) — round-16 決済裁定: 銀行振込P2P・IHL非関与。
  //    磨き第2弾#1(受領10「買い手/売り手のみ表示」): `when` role gating —
  //    the buyer must NOT see the seller-only "入金を確認した" button here.
  await buyer.getByRole("tab", { name: "取引ボード(成立後)" }).click();
  await expect(buyer.getByRole("button", { name: "振込済みを申告する(買い手)" })).toBeVisible();
  await expect(buyer.getByRole("button", { name: "入金を確認した(出品者)" })).not.toBeVisible();
  await buyer.getByRole("button", { name: "振込済みを申告する(買い手)" }).click();
  await waitForKind(buyer, "pay_declare");
  await buyer.waitForLoadState("networkidle");
  await buyer.getByRole("tab", { name: "取引ボード(成立後)" }).click();
  await expect(buyer.getByText(/振込済み申告 \d{4}-\d{2}-\d{2}/)).toBeVisible();

  // 5. 出品者: 入金を確認した → 発送した. Symmetric `when` check: the seller
  //    must NOT see the buyer-only "受け取りました" button.
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByRole("tab", { name: "取引ボード(成立後)" }).click();
  await expect(page.getByText(/振込済み申告 \d{4}-\d{2}-\d{2}/)).toBeVisible();
  await expect(page.getByRole("button", { name: "受け取りました(検品OK・買い手)" })).not.toBeVisible();
  await page.getByRole("button", { name: "入金を確認した(出品者)" }).click();
  await waitForKind(page, "pay_confirm");
  await page.waitForLoadState("networkidle");
  await page.getByRole("tab", { name: "取引ボード(成立後)" }).click();
  await expect(page.getByText(/入金確認 \d{4}-\d{2}-\d{2}/)).toBeVisible();
  await page.getByRole("button", { name: "発送した(出品者)" }).click();
  await waitForKind(page, "ship");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/状態 shipped/)).toBeVisible();

  // 6. 買い手: 受け取りました(検品OK) — 3出口のうち「一致確定」に相当する
  //    最小トグル(部分検品/相違記録UIはbackendの検品APIが個体単位でないため
  //    対象外・c8タスク報告に明記)。
  await buyer.reload();
  await buyer.waitForLoadState("networkidle");
  await buyer.getByRole("tab", { name: "取引ボード(成立後)" }).click();
  await buyer.getByRole("button", { name: "受け取りました(検品OK・買い手)" }).click();
  await waitForKind(buyer, "receive");
  await buyer.waitForLoadState("networkidle");
  await expect(buyer.getByText(/状態 received/)).toBeVisible();

  // 7. 「買う」タブは全出品の実一覧(GET /market/listings)で、磨き第2弾#2
  //    (受領10「画像を押せば詳細が出る」)以降は image-grid カード全体が
  //    リンクになっている(旧: table + 「詳細を開く」セルリンク)。この
  //    listing には写真を出品していないので placeholder glyph(📷)で表示される
  //    (壊れた <img> ではなく正直な空スロット表示)。append-only Truth に
  //    過去の e2e 実行分の出品が積み上がるため、📷 の存在確認はこの listing
  //    のリンク配下に限定する(page全体だとstrict mode違反になる)。
  await page.goto(`${WEB}/s/market-trade`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("tab", { name: "買う" }).click();
  const listingLink = page.getByRole("link", { name: new RegExp(title) });
  await expect(listingLink.getByText("📷")).toBeVisible();
  await listingLink.click();
  await expect(page.getByText(`${title} / 12000 円`)).toBeVisible();
});
