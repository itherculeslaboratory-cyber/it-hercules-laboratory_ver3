import { test, expect, type Page } from "@playwright/test";

// wave1 KNW「種族の本」(R133=○○90点採用・承認mockup D:\claude\00-hq\dashboard\
// mockups\knw-species-book.html) 実ブラウザ通貫: dev-login → PATCH /me/preferences
// で観測対象(scope_species)を実 API へ確定 → species_id 付きの投稿を2件POST
// (SW-1でスキーマ許可済み・実 API・append-only Truth への書込)→ /s/knowledge-hub
// を開き「この種族の本」タブへ切替 → 実データで章とバッジが出ることを確認。

const WEB = "http://127.0.0.1:3000";

async function devLogin(page: Page): Promise<void> {
  await page.goto(`${WEB}/s/login`);
  await page.getByRole("button", { name: "開発トークンでログイン" }).click();
  await expect(page.getByRole("heading", { name: "ホーム" })).toBeVisible();
}

test("knowledge species book: species_id posts seeded via real API render as a chapter with the right badge", async ({ page }) => {
  await devLogin(page);

  const speciesId = `e2e-sp-${Date.now().toString(36)}`;
  const topic = "E2E種族の本チャプター確認";

  // 1. set the global 観測対象(scope_species) preference via the real API —
  //    the header selector this normally goes through (HeaderScopeSelector) is
  //    a modal dialog driven by taxonomy search; PATCHing directly is the same
  //    write path (renderer.tsx patchScope) without needing a seeded taxon.
  const patch = await page.evaluate(
    async (sp) => {
      const r = await fetch("/api/v1/me/preferences", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope_species: sp }),
      });
      return { status: r.status };
    },
    speciesId,
  );
  expect(patch.status, "PATCH /me/preferences must succeed").toBe(200);

  // 2. seed a thread (root + one reply, same topic) with species_id attached —
  //    projectSpeciesBook groups by species_id×topic into one chapter.
  const seedRoot = await page.evaluate(
    async ({ sp, tp }) => {
      const r = await fetch("/api/v1/plaza/posts", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channel: "knowledge-board",
          board_kind: "guide",
          topic: tp,
          body: "E2Eからの実観測本文(章の答え候補)",
          species_id: sp,
        }),
      });
      return { status: r.status, json: await r.json() };
    },
    { sp: speciesId, tp: topic },
  );
  expect(seedRoot.status, "seed root post must be 201").toBe(201);
  const threadId = (seedRoot.json as { thread_id?: string }).thread_id!;

  const seedReply = await page.evaluate(
    async ({ sp, tp, tid }) => {
      const r = await fetch("/api/v1/plaza/posts", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channel: "knowledge-board",
          board_kind: "guide",
          topic: tp,
          thread_id: tid,
          body: "E2Eからの2件目(束ねたスレ確認用)",
          species_id: sp,
        }),
      });
      return { status: r.status };
    },
    { sp: speciesId, tp: topic, tid: threadId },
  );
  expect(seedReply.status, "seed reply post must be 201").toBe(201);

  // 3. open the hub — the header scope chip should already reflect the
  //    patched species (real GET /me/preferences on mount).
  await page.goto(`${WEB}/s/knowledge-hub`);
  await expect(page.getByRole("button", { name: `観測対象: ${speciesId}` })).toBeVisible();

  // 4. switch to 「この種族の本」and confirm the real chapter renders — no
  //    citations/retries were seeded, so classifyPromotion falls through to
  //    "open" → badge "△ まだ未検証" (honest, not fabricated verification).
  await page.getByRole("button", { name: "この種族の本" }).click();
  await expect(page.getByRole("heading", { name: `📖 ${speciesId}の本` })).toBeVisible();
  // topic appears 3x (chapter-row + featured "章をひらくと" heading + tree
  // chip) — assert the chapter-row occurrence specifically.
  await expect(page.locator(".chapter-row", { hasText: topic })).toBeVisible();
  await expect(page.getByText("△ まだ未検証")).toBeVisible();
  await expect(page.getByText(/束ねたスレ 1件/)).toBeVisible();
});
