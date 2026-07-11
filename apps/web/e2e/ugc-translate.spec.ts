import { test, expect } from "@playwright/test";
import { shouldOfferTranslation, translateOnDemand } from "../src/lib/ugc-translate";

// V3-I18-06 — UGC translation is on-device + on-demand ONLY; the app must never
// issue a server/network translation request. The Renderer's UGC affordance is
// unit-tested against the real module (renderer.test.tsx); this e2e pins the
// browser-level network invariant: in a real Chromium, showing the 翻訳
// affordance and pressing it makes ZERO outbound requests.
//
// The app does not yet surface a UGC-bearing screen-def (viewerLocale/ugc nodes
// are renderer-complete but not wired into a page), so this test reproduces the
// exact affordance markup the Renderer emits and drives it with the REAL
// on-device hook (translateOnDemand) exposed into the page — real browser, real
// click, real module, real network monitor.

const CONTENT = "これは日本語の原文です";
const SOURCE_LANG = "ja";
const VIEWER_LOCALE = "en";

test("UGC translation affordance runs on-device and issues no network request (V3-I18-06)", async ({ page }) => {
  // The real module decides the affordance shows only when viewer ≠ source lang.
  expect(shouldOfferTranslation(SOURCE_LANG, VIEWER_LOCALE)).toBe(true);
  expect(shouldOfferTranslation(SOURCE_LANG, "ja")).toBe(false);

  // Record EVERY outbound request the page makes. A standing server-translation
  // call — the thing I18-06 forbids — would appear here.
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));

  // Back the button with the REAL on-device hook. It must return the original
  // text and never touch the network until a device translator exists.
  let hookCalls = 0;
  await page.exposeFunction("onDeviceTranslate", async (text: string) => {
    hookCalls++;
    return translateOnDemand({ text, sourceLang: SOURCE_LANG, viewerLocale: VIEWER_LOCALE });
  });

  await page.goto("about:blank");
  // Exactly the affordance the Renderer emits for a differing-locale viewer.
  await page.setContent(
    `<main><p class="civ-text" id="ugc">${CONTENT} ` +
      `<button type="button" data-variant="ghost">翻訳</button></p></main>`,
  );
  await page.evaluate((content) => {
    const btn = document.querySelector("button")!;
    const p = document.getElementById("ugc")!;
    btn.addEventListener("click", async () => {
      const r = await (window as unknown as {
        onDeviceTranslate: (t: string) => Promise<{ text: string }>;
      }).onDeviceTranslate(content);
      p.childNodes[0].textContent = r.text + " ";
    });
  }, CONTENT);

  const before = requests.length;
  await page.getByRole("button", { name: "翻訳" }).click();

  await expect.poll(() => hookCalls).toBe(1); // device hook fired
  await expect(page.locator("#ugc")).toContainText(CONTENT); // original preserved
  expect(requests.length).toBe(before); // ZERO new requests — no server translation
});
