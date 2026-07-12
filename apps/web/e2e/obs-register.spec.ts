import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// V3-AIP-101 観測登録スライス1(既存個体への追観測の1個体動線)。dev-login → API で
// 個体+初回観測を seed → F1(検索で対象確定)→ F2(体重入力・前回値とのΔ表示を
// assert)→ F5(確認)→ F6(保存後Δ+「次の目安」登録済みを assert)→ もう一度 F1 を
// 開き、F2 で開いた個体が候補チップに浮上することを assert。screen-sweep とは別に、
// この5画面は実ブラウザで打鍵まで通す(目視ゲート用スクリーンショット4+1枚)。
const WEB = "http://127.0.0.1:3000";
const SPEC_DIR = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(SPEC_DIR, "..", "..", "..", "docs", "planning", "c7", "screens");
const shot = (page: Page, name: string) =>
  page.screenshot({ path: resolve(SHOTS, `obs-register-v4a-${name}.png`), fullPage: true });

async function devLogin(page: Page) {
  await page.goto(`${WEB}/s/login`);
  await page.getByRole("button", { name: "開発トークンでログイン" }).click();
  await expect(page.getByRole("heading", { name: "観測ホーム" })).toBeVisible();
}

test("観測登録スライス1: F1(検索)→F2(Δ)→F5→F6(Δ+次の目安)→F1(候補チップ)", async ({ page }) => {
  await devLogin(page);

  // 1. 個体 + 初回観測(体重82.5g)を API で seed — この run 専用のラベルで検索を
  //    一意にする(append-only R2 は run をまたいで蓄積するため)。
  const label = `E2E-DHH-${Date.now().toString(36)}`;
  const seed = await page.evaluate(async (label) => {
    const ind = await fetch("/api/v1/individuals", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ local_label_text: label, species: "Dynastes hercules" }),
    }).then((r) => r.json());
    await fetch("/api/v1/observation/captures", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        domain: "biology",
        subject_ref: `individual/${ind.individual_id}`,
        measurements: [{ item: "weight", kind: "number", value: 82.5, unit: "g", value_origin: "direct_observed" }],
      }),
    });
    return { individualId: ind.individual_id as string };
  }, label);
  expect(seed.individualId).toBeTruthy();

  // 2. F1: 検索で対象確定(候補チップは履歴ゼロなのでまだ出ない).
  await page.goto(`${WEB}/s/obs-register`);
  await expect(page.getByRole("heading", { name: "記録する" })).toBeVisible();
  await page.getByLabel("個体・種で検索").fill(label);
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(label)).toBeVisible();
  await shot(page, "f1");
  await page.getByRole("link", { name: "追観測へ →" }).click();

  // 3. F2: 継承ヘッダ + 前回値とΔ(体重を入力して前回82.5gとの差分が出ることを assert).
  await expect(page.getByRole("heading", { name: "追観測" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(label)).toBeVisible(); // 継承ヘッダにラベルが出る
  await page.getByLabel("体重(g)").fill("85.8");
  await expect(page.getByText(/前回 82\.5g/)).toBeVisible();
  await expect(page.getByText(/\+3\.3g↑/)).toBeVisible();
  await page.getByLabel("体長(mm)").fill("20");
  await shot(page, "f2");
  await page.getByRole("button", { name: "確認へ →" }).click();

  // 4. F5: recap + 「次の目安を登録」既定ON.
  await expect(page.getByRole("heading", { name: "確認" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("体重 85.8g")).toBeVisible();
  await expect(page.getByText("体長 20mm")).toBeVisible();
  await expect(page.getByLabel(/次の目安を登録/)).toBeChecked();
  await shot(page, "f5");
  await page.getByRole("button", { name: "保存" }).click();

  // 5. F6: 保存直後のΔ + 次の目安のゼロタップ登録.
  await expect(page.getByRole("heading", { name: "保存しました" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/体重 85\.8g/)).toBeVisible();
  await expect(page.getByText(/\+3\.3g↑/)).toBeVisible();
  await expect(page.getByText(/✓ 次の目安 登録済み/)).toBeVisible();
  await shot(page, "f6");

  // 6. もう一度 F1 を開くと、F2 で開いた個体が候補チップに浮上する(localStorage 履歴).
  //    磨き直し fix#1: チップは ID 全文ではなくラベル(+種/ステージ)で表示する
  //    — ここでは個体の ID そのものが画面に出ていないことも合わせて確認する。
  await page.goto(`${WEB}/s/obs-register`);
  await expect(page.getByRole("heading", { name: "記録する" })).toBeVisible();
  const chip = page.getByRole("button", { name: new RegExp(label) });
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("Dynastes hercules");
  await expect(page.getByText(seed.individualId)).toHaveCount(0);
  await shot(page, "f1b");
});
