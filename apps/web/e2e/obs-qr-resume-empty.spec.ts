import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// wave1-obs OBS round-1: the EMPTY-shelf branch of GET /qr/:token?prefill=1
// (observation-routes.ts:1197 → entry_mode:"qr_placement_empty", individual_id:
// null). Previously the qr-resume screen-def only had the occupied-individual
// path, so an empty-shelf QR rendered "個体が見つかりました" with a dead
// resume button (navigate to obs-register-entry?id=<empty>). This spec proves
// the new branch end to end in a real browser: seed a placement with NO
// occupancy event (source-routes.ts POST /placements — no occupant ⇒
// projectOccupantAt returns null), issue its env QR (POST /placements/:id/qr),
// then scan it and follow the "この棚で新規個体を登録" button through to
// obs-register-new. Kept as its own file (not appended to observation.spec.ts,
// which already pins the OCCUPIED path at its own §7-8 as regression proof —
// see docs/planning/c2/e2e-screenshots/08-qr-resume.png for that state).
const WEB = "http://127.0.0.1:3000";
const SPEC_DIR = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(SPEC_DIR, "..", "..", "..", "docs", "planning", "c9", "screens");
const shot = (page: Page, name: string) => page.screenshot({ path: resolve(SHOTS, `${name}.png`) });

async function devLogin(page: Page) {
  await page.goto(`${WEB}/s/login`);
  await page.getByRole("button", { name: "開発トークンでログイン" }).click();
  await expect(page.getByRole("heading", { name: "ホーム" })).toBeVisible();
}

test("empty-shelf QR → 空の棚です → この棚で新規個体を登録 → obs-register-new", async ({ page }) => {
  await devLogin(page);

  // Seed a placement with no occupancy event, then issue its shelf QR — both
  // via the same-origin /api rewrite so the dev-login session cookie
  // authenticates the writes (same pattern as obs-register.spec.ts's seed step).
  const label = `E2E-EMPTY-SHELF-${Date.now().toString(36)}`;
  const { token } = await page.evaluate(async (label) => {
    const placement = await fetch("/api/v1/placements", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label }),
    }).then((r) => r.json());
    const qr = await fetch(`/api/v1/placements/${placement.placement_id}/qr`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }).then((r) => r.json());
    return { placementId: placement.placement_id as string, token: qr.token as string };
  }, label);
  expect(token).toMatch(/^[A-Za-z0-9_-]{20,200}$/);

  // Scan the shelf QR — no occupant ⇒ entry_mode:"qr_placement_empty".
  await page.goto(`${WEB}/qr/${token}`);
  await expect(page.getByRole("heading", { name: "空の棚です" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "個体が見つかりました" })).not.toBeVisible();
  const registerNewBtn = page.getByRole("button", { name: "この棚で新規個体を登録" });
  await expect(registerNewBtn).toBeVisible();
  await shot(page, "qr-resume-empty");

  await registerNewBtn.click();
  await expect(page.getByRole("heading", { name: "新規個体として登録" })).toBeVisible();
});
