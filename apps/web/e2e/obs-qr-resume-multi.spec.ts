import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// wave1-obs OBS round-2 (persona R75): a shelf can hold MULTIPLE adults at
// once. projectOccupantAt (source-routes.ts) returns only the FIRST open
// occupancy, silently collapsing a multi-occupant shelf to one arbitrary
// individual — observations could land on the wrong one. This spec proves the
// new qr_placement_multi branch (observation-routes.ts GET /qr/:token,
// projectOccupantsAt) end to end: seed a placement with 2 individuals BOTH
// currently occupying it (batch-commit kind:"move" — the real HTTP path that
// writes an occupancy phase:"start" record; POST /occupancy itself never sets
// phase and so never registers as "open" for projectOccupantsAt), issue the
// shelf's env QR, scan it, and confirm the user is asked to pick which
// individual instead of silently landing on one. Kept as its own file (same
// precedent as obs-qr-resume-empty.spec.ts for the empty-shelf branch).
const WEB = "http://127.0.0.1:3000";
const SPEC_DIR = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(SPEC_DIR, "..", "..", "..", "docs", "planning", "c9", "screens");
const shot = (page: Page, name: string) => page.screenshot({ path: resolve(SHOTS, `${name}.png`) });

async function devLogin(page: Page) {
  await page.goto(`${WEB}/s/login`);
  await page.getByRole("button", { name: "開発トークンでログイン" }).click();
  await expect(page.getByRole("heading", { name: "観測ホーム" })).toBeVisible();
}

test("multi-occupant shelf QR → この棚の個体を選ぶ → 追観測へ → obs-register-entry", async ({ page }) => {
  await devLogin(page);

  const tag = Date.now().toString(36);
  const label1 = `E2E-MULTI-A-${tag}`;
  const label2 = `E2E-MULTI-B-${tag}`;
  const { token } = await page.evaluate(
    async ({ label1, label2 }) => {
      const post = async (path: string, body: unknown) =>
        fetch(`/api/v1${path}`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }).then((r) => r.json());

      const placement = await post("/placements", { label: `E2E-MULTI-SHELF-${label1}` });
      const ind1 = await post("/individuals", { local_label_text: label1, species: "Dynastes hercules" });
      const ind2 = await post("/individuals", { local_label_text: label2, species: "Dynastes hercules" });
      // batch-commit kind:"move" is the real path that writes an occupancy
      // phase:"start" record (POST /occupancy alone never sets phase, so it
      // never counts as "open" for projectOccupantAt/projectOccupantsAt).
      await post("/observation/batch-commit", {
        items: [
          { kind: "move", subject_ref: `individual/${ind1.individual_id}`, to_placement_id: placement.placement_id },
          { kind: "move", subject_ref: `individual/${ind2.individual_id}`, to_placement_id: placement.placement_id },
        ],
      });
      const qr = await post(`/placements/${placement.placement_id}/qr`, {});
      return { token: qr.token as string };
    },
    { label1, label2 },
  );
  expect(token).toMatch(/^[A-Za-z0-9_-]{20,200}$/);

  // Scan the shelf QR — 2 open occupants ⇒ entry_mode:"qr_placement_multi".
  await page.goto(`${WEB}/qr/${token}`);
  await expect(page.getByRole("heading", { name: "この棚の個体を選ぶ" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "個体が見つかりました" })).not.toBeVisible();
  const table = page.locator("table.civ-table");
  await expect(table).toBeVisible();
  await expect(table.getByText(label1)).toBeVisible();
  await expect(table.getByText(label2)).toBeVisible();
  const links = page.getByRole("link", { name: "追観測へ →" });
  await expect(links).toHaveCount(2);
  await shot(page, "qr-resume-multi");

  await links.first().click();
  await expect(page.getByRole("heading", { name: "追観測" })).toBeVisible();
});
