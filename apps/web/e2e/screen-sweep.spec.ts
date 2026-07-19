import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// C7 T1 — full-screen sweep. Opens EVERY screen in navigation.json in a real
// browser (dev-login authenticated, same-origin cookie via next.config rewrite,
// same as observation.spec) and, per screen, asserts the page is not blank and
// threw no uncaught exception, then saves a screenshot. This is honest-evidence
// tooling (V3-AIP-101): a data-empty 4xx fetch is allowed IF the screen still
// renders its heading/empty-state (the renderer's useSource swallows the fetch
// error and shows empty_text), but a blank page or an uncaught error is a FAIL.

const WEB = "http://127.0.0.1:3000";
const SPEC_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SPEC_DIR, "..", "..", "..");
const SHOTS = resolve(REPO_ROOT, "docs", "planning", "c7", "screens");
const NAV = JSON.parse(
  readFileSync(resolve(REPO_ROOT, "screen-defs", "navigation.json"), "utf8"),
) as { screens: string[] };

// Failed resource loads (the data-empty 4xx the task explicitly permits) surface
// as console "error" messages too. Distinguish them from real app errors by their
// canonical browser prefix so they don't mask genuine console.error / crashes.
const isResourceLoadError = (text: string) => /Failed to load resource/i.test(text);

// dev-login (V3-AUT-05): the in-screen button POSTs /auth/dev-login same-origin;
// its HttpOnly session cookie then authenticates every /s/<id> visit. Contexts
// are isolated per test, so each test logs in fresh.
async function devLogin(page: Page) {
  await page.goto(`${WEB}/s/login`);
  await page.getByRole("button", { name: "開発トークンでログイン" }).click();
  await expect(page.getByRole("heading", { name: "ホーム" })).toBeVisible();
}

test.describe("screen sweep", () => {
  for (const id of NAV.screens) {
    test(`screen ${id}`, async ({ page }) => {
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      const resourceErrors: string[] = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));
      page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        const t = msg.text();
        (isResourceLoadError(t) ? resourceErrors : consoleErrors).push(t);
      });

      await devLogin(page);
      await page.goto(`${WEB}/s/${id}`);
      // Let source_path fetches settle (data-empty ones resolve to empty state).
      await page.waitForLoadState("networkidle");

      // (c) evidence screenshot FIRST — captured for every screen, including a
      //     crashed one (the Next error overlay is itself evidence).
      await page.screenshot({ path: resolve(SHOTS, `${id}.png`), fullPage: true });

      // Data-empty 4xx resource errors are allowed; report them, don't fail.
      if (resourceErrors.length) {
        test.info().annotations.push({
          type: "data-empty-4xx",
          description: `${id}: ${resourceErrors.length} resource load error(s) — allowed (empty-state rendered)`,
        });
      }

      // (b) no uncaught exception. Assert this before the heading so a client-side
      //     crash surfaces its real message instead of a generic "blank page".
      expect(pageErrors, `${id}: uncaught exceptions: ${pageErrors.join(" | ")}`).toEqual([]);
      expect(consoleErrors, `${id}: console errors: ${consoleErrors.join(" | ")}`).toEqual([]);

      // (a) not blank: every screen def carries a visible heading — it must render.
      //     A blank/notFound page has none. KNW wave1 の verbatim-mockup 採用ノード
      //     (knowledge-hub/thread) は .civ-heading でなく mockup 由来の .section-title /
      //     .thread-title で見出しを描画するため、それらも「見出しあり=非空」として許容する。
      const heading = page.locator(".civ-heading, .section-title, .thread-title").first();
      await expect(heading, `${id}: no visible heading (blank page)`).toBeVisible();
    });
  }
});
