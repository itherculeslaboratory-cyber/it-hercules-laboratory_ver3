import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// C8 UI レビューシート用の全画面スクショ再生成(HANDOFF §7 DoD-3)。既存の
// screen-sweep.spec.ts(C7・c7/screens・単一幅fullPage)と同じ devLogin/NAV
// パターンを流用し、モバイル(390px)/デスクトップ(1440px)の2幅で c8/screens へ
// 撮る。合否アサーションは screen-sweep.spec.ts が既に担っているため、本specは
// 純粋な証跡撮影のみ(空データ4xx等の許容ロジックを重複させない)。
// market-trade / knowledge-thread は c8-showcase-screens.spec.ts が実データ
// 投入済みの状態でより代表的な画面を撮るため、ここでは対象から除外する
// (受領10で60点だった3画面はshowcase側の named ファイルをレビューシートで使う)。
const WEB = "http://127.0.0.1:3000";
const SPEC_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SPEC_DIR, "..", "..", "..");
const SHOTS = resolve(REPO_ROOT, "docs", "planning", "c8", "screens");
const NAV = JSON.parse(
  readFileSync(resolve(REPO_ROOT, "screen-defs", "navigation.json"), "utf8"),
) as { screens: string[] };
const SHOWCASE_IDS = new Set(["market-trade", "knowledge-thread"]);
const SWEEP_IDS = NAV.screens.filter((id) => !SHOWCASE_IDS.has(id));
// obs-search.spec.ts の既存コメントどおり: append-only Truth はこの開発環境の
// 過去run分が全て累積するため、一覧/グリッド系のfullPage撮影は「巨大な壁」に
// なる(obs-register/obs-search/obs-register-batch で実測 3-7万px)。viewport
// のみ撮ることで実用的なサムネにする(3画面のみの例外・他は既存どおりfullPage)。
const VIEWPORT_ONLY_IDS = new Set(["obs-register", "obs-search", "obs-register-batch", "device", "economy-status"]);
const WIDTHS: Array<{ w: number; h: number }> = [
  { w: 1440, h: 900 },
  { w: 390, h: 844 },
];

async function devLogin(page: Page) {
  await page.goto(`${WEB}/s/login`);
  await page.getByRole("button", { name: "開発トークンでログイン" }).click();
  // devLogin self-navigates to home post-login (renderer navigate()) — wait for
  // that to actually land before the caller issues its OWN goto, otherwise the
  // two in-flight navigations race and Playwright aborts one (net::ERR_ABORTED).
  await expect(page.getByRole("heading", { name: "観測ホーム" })).toBeVisible();
}

test.describe("c8 full sweep (2 widths)", () => {
  for (const id of SWEEP_IDS) {
    for (const { w, h } of WIDTHS) {
      test(`screen ${id} @ ${w}`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await devLogin(page);
        await page.goto(`${WEB}/s/${id}`);
        await page.waitForLoadState("networkidle");
        const fullPage = !VIEWPORT_ONLY_IDS.has(id);
        await page.screenshot({ path: resolve(SHOTS, `${id}-${w}.png`), fullPage });
      });
    }
  }
});
