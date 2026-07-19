import { test, expect, type Page } from "@playwright/test";

// 代替A+B(R174)の触れる実物スクショ。fork→微調整→保存が実際にできること、パレットに
// 実動部品(検索2種)+ボタン動作があること、ボタンに検索を紐付けたものが実際に動くこと
// (/s/obs-entry の「対象を特定する」→本物の検索画面)を、実サーバ+実ログインで撮る。
const WEB = "http://127.0.0.1:3000";
const SHOTS = "D:/claude/00-hq/review-queue/evidence/fork-ab";

async function devLogin(page: Page): Promise<void> {
  await page.goto(`${WEB}/s/login`);
  await page.getByRole("button", { name: "開発トークンでログイン" }).click();
  await expect(page.getByRole("heading", { name: "ホーム" })).toBeVisible();
}

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.getByRole("button", { name: theme === "dark" ? "暗い" : "明るい" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function shot(page: Page, name: string) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: `${SHOTS}/${name}-1440.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({ path: `${SHOTS}/${name}-390.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
}

test("fork-ab: builder both themes, fork→tweak→save, button-wired-to-search live", async ({ page }) => {
  test.setTimeout(180_000);
  await devLogin(page);

  // ── /fork ビルダー(パレットに検索2種+ボタン動作) 両テーマ×両幅 ──
  await page.goto(`${WEB}/fork`);
  await expect(page.getByText("① 既存の画面を fork")).toBeVisible();
  // パレットに検索2種が出ている(実動部品の開放)。
  await expect(page.getByText("検索(個体をしぼり込む)").first()).toBeVisible();
  await expect(page.getByText("検索(観測対象をたどる)").first()).toBeVisible();
  await setTheme(page, "light");
  await shot(page, "builder-light");
  await setTheme(page, "dark");
  await shot(page, "builder-dark");
  await setTheme(page, "light");

  // ── (あ) 既存画面を fork(コピー)して開く ── 「運営コスト」を選ぶ。
  await page.locator('select:has(option[value="costs"])').selectOption("costs");
  await page.getByRole("button", { name: /fork して開く/ }).click();
  await expect(page.getByText(/fork して編集中/)).toBeVisible();
  // 実データ入りの既存部品は「そのまま保持」で無劣化保持されている(正直表示)。
  await expect(page.getByText(/そのまま保持/).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/fork-open-1440.png`, fullPage: true });

  // ── (あ) プロパティ微調整: 見出しをクリックで選び、テキストを直す ──
  // キャンバス内の見出し div(exact text)を掴む(picker の <option> や fork バナーを避ける)。
  await page.locator('div:text-is("運営コスト")').first().click();
  const inputs = page.locator('input[type="text"]');
  const n = await inputs.count();
  let tweaked = false;
  for (let i = 0; i < n; i++) {
    if ((await inputs.nth(i).inputValue()) === "運営コスト") {
      await inputs.nth(i).fill("運営コスト(わたしの写し)");
      tweaked = true;
      break;
    }
  }
  expect(tweaked, "見出しのテキスト欄を編集できる(プロパティ微調整)").toBe(true);
  await page.screenshot({ path: `${SHOTS}/tweak-1440.png`, fullPage: true });

  // ── (あ) 保存(実 POST /builder/canvas)——本物のテンプレIDが返る ──
  await page.getByRole("button", { name: "テンプレートとして保存する" }).click();
  await expect(page.getByText(/保存しました.*テンプレID/)).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/saved-1440.png`, fullPage: true });

  // ── (い) ボタンに検索を紐付けたものが実際に動く: 既存 /s/obs-entry の
  //         「対象を特定する」(action=navigate→obs-navigator)を押すと本物の検索へ ──
  await page.goto(`${WEB}/s/obs-entry`);
  await expect(page.getByRole("button", { name: "対象を特定する" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/button-search-entry-1440.png`, fullPage: true });
  await page.getByRole("button", { name: "対象を特定する" }).click();
  await page.waitForURL(/obs-navigator/, { timeout: 15_000 });
  // 本物の検索部品(target-navigator: 名前/はい・いいえ/分類)が描画される。
  await expect(page.getByText(/名前|分類|はい/).first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/button-search-live-1440.png`, fullPage: true });
});
