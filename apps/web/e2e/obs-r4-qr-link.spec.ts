import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

// OBS-R4 (個体QRスキャン→紐づけハブ). Proves the approved prediction picture's
// real flow end to end: scan an individual QR → 「個体が見つかりました」→ the new
// 「この個体に紐づける」hub (追観測 / 棚 / 繁殖) → tap 繁殖 → 割り出し opens with the
// scanned individual already prefilled as a parent candidate (?parent_id= wiring,
// ClutchIntakeNode prefill). Also produces the 4 evidence screenshots (両テーマ×
// 両幅) for the HQ judgment card. Mirrors obs-qr-resume-empty.spec.ts's seed
// pattern (same-origin /api rewrite so the dev-login cookie authenticates writes).
const WEB = "http://127.0.0.1:3000";
const SHOTS = "D:/claude/00-hq/review-queue/evidence/obs-r4-impl-2026-07-19";

// Capture at 2x DPR so the mobile (390) evidence renders crisp like a real
// phone (~2-3x DPI) instead of thin/aliased at DPR=1 — representative of what
// the user actually sees on a handset.
test.use({ deviceScaleFactor: 2 });

async function devLogin(page: Page) {
  await page.goto(`${WEB}/s/login`);
  await page.getByRole("button", { name: "開発トークンでログイン" }).click();
  await expect(page.getByRole("heading", { name: "ホーム" })).toBeVisible();
}

test("individual QR → 個体が見つかりました → 紐づけハブ(追観測/棚/繁殖) → 繁殖 opens 割り出し with the scanned individual prefilled as a parent", async ({ page }) => {
  mkdirSync(SHOTS, { recursive: true });
  await devLogin(page);

  const label = "ヘラクレス♂ 2024-A-013";
  const { token } = await page.evaluate(async (label) => {
    const ind = await fetch("/api/v1/individuals", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ local_label_text: label, species: "Dynastes hercules" }),
    }).then((r) => r.json());
    const qr = await fetch(`/api/v1/individuals/${ind.individual_id}/qr`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }).then((r) => r.json());
    return { individualId: ind.individual_id as string, token: qr.token as string };
  }, label);
  expect(token).toMatch(/^[A-Za-z0-9_-]{20,200}$/);

  // Scan the individual QR — resolves to the individual (occupied path).
  await page.goto(`${WEB}/qr/${token}`);
  await expect(page.getByRole("heading", { name: "個体が見つかりました" })).toBeVisible();

  // The R4 hub: title + all three destinations are present.
  await expect(page.getByRole("heading", { name: "この個体に紐づける" })).toBeVisible();
  await expect(page.getByRole("button", { name: "この個体で観測を続ける" })).toBeVisible(); // ① 追観測 (既存導線)
  await expect(page.getByRole("link", { name: "棚に置く・移す →" })).toBeVisible(); // ② 棚 (obs-register-batch)
  const clutchBtn = page.getByRole("button", { name: "繁殖(クラッチ)に親として記録 →" }); // ③ 繁殖 (R4新規配線)
  await expect(clutchBtn).toBeVisible();

  // Evidence screenshots: 両テーマ × 両幅 of the hub. Drive the app's real
  // theme lever (:root[data-theme] hard override, tokens.generated.css) — the
  // same thing the AppShell ThemeToggle stamps — not emulateMedia, which the
  // data-theme override wins over.
  for (const [w, name] of [
    [1280, "1280"],
    [390, "390"],
  ] as const) {
    await page.setViewportSize({ width: w, height: 900 });
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await page.screenshot({ path: `${SHOTS}/obs-r4-${name}-${theme}.png`, fullPage: true });
    }
  }
  // Reset to a normal desktop viewport + light theme for the interaction.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));

  // Tap 繁殖 → 割り出し, and the scanned individual is prefilled as a parent.
  await clutchBtn.click();
  await expect(page.getByRole("heading", { name: "割り出し — 新しいクラッチ" })).toBeVisible();
  await expect(page.getByText(label)).toBeVisible(); // prefilled parent badge
  await expect(page.getByRole("button", { name: "✕ 変更" }).first()).toBeVisible();
});
