import { test, expect, type Page } from "@playwright/test";

// c8(ui-asset-catalog.md 【最優先2】)再構築版・UI磨き第2弾(受領10)で追改修 —
// 知の広場 per-thread ビューの実ブラウザ通貫。dev-login → スレを1本作成
// (POST /plaza/posts で thread_id/topic を確定)→ /s/knowledge-thread?thread_id=...
// を実 worker + R2-local で描画 → (1) スレ頭カード+専用ノード thread-posts が
// 実 API 値を綴じて可視 (2) 返信 compose(textarea variant)で新規投稿→自動
// 再読込 (3) 磨き第2弾#6: 投稿ごとのインライン賛否ボタン(Agree/Disagree/Pass・
// 投稿ID手入力は撤去)を投じ Polis 型 consensus 投影(table)が反映 (4) 磨き
// 第2弾#3: 「この投稿を相談室へ」は既定非表示・kebab(⋮)を開いて初めて見える
// (5) スレ主(dev actor 自身)だけに見える解決マーク(round-16 OQ-PLZ-03)をトグル。

const WEB = "http://127.0.0.1:3000";

async function devLogin(page: Page): Promise<void> {
  await page.goto(`${WEB}/s/login`);
  await page.getByRole("button", { name: "開発トークンでログイン" }).click();
  await expect(page.getByRole("heading", { name: "観測ホーム" })).toBeVisible();
}

test("knowledge thread: view (avatar/body/cite) -> reply -> stance vote -> thread-starter resolve mark", async ({ page }) => {
  await devLogin(page);

  // 1. seed a thread via the real API (same-origin cookie auth) — the dev
  //    actor is the root post's author, i.e. the thread starter.
  const threadId = `e2e-thr-${Date.now().toString(36)}`;
  const post = await page.evaluate(async (tid) => {
    const r = await fetch("/api/v1/plaza/posts", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ thread_id: tid, channel: "knowledge-board", topic: "E2E consensus check", board_kind: "improvement", body: "first post" }),
    });
    return { status: r.status, json: await r.json() };
  }, threadId);
  expect(post.status, "seed post must be 201").toBe(201);
  const postId = (post.json as { post_id: string }).post_id;
  expect(typeof postId).toBe("string");

  // 2. open the per-thread screen with the thread_id as a query param.
  await page.goto(`${WEB}/s/knowledge-thread?thread_id=${threadId}`);
  await expect(page.getByRole("heading", { name: "スレッド", level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");

  // head card (topic) + thread-posts (real body text, not a mock).
  await expect(page.getByText("話題: E2E consensus check（チャンネル knowledge-board）")).toBeVisible();
  // c9 wave1 KNW Slice2: "first post" now also appears as the consensus
  // table's readable excerpt (論点 column), so scope this to the post article
  // itself rather than a page-wide getByText (which would be ambiguous).
  await expect(page.locator("article.civ-thread-post").getByText("first post")).toBeVisible();
  // starter-only resolve mark (round-16 OQ-PLZ-03) — dev actor authored the
  // root post, so it must be visible and start unresolved.
  await expect(page.getByText("未解決")).toBeVisible();
  await expect(page.getByRole("button", { name: "✔ 解決済みにする" })).toBeVisible();

  // 3. reply compose (textarea variant, c8) — self-navigates back here so the
  //    new post is visible without a manual reload.
  await page.getByLabel("返信本文 *").fill("これはE2Eからの返信です");
  await page.getByRole("button", { name: "返信する" }).click();
  await expect(page.getByRole("heading", { name: "スレッド", level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("これはE2Eからの返信です")).toBeVisible();

  // 4. 磨き第2弾#6: cast a stance via the seed post's OWN inline vote button
  //    (no more manual "対象の投稿 ID" field — the post is scoped by
  //    data-post-id, since the reply post from step 3 has an identical-looking
  //    "賛成" button of its own). The consensus projection recounts and the
  //    Polis table shows the tally.
  const seedArticle = page.locator(`article[data-post-id="${postId}"]`);
  await seedArticle.getByRole("button", { name: "賛成" }).click();
  await page.waitForLoadState("networkidle");
  await page.reload(); // per-post vote has no self-navigate transition (matches the pre-c8 stance-form behaviour)
  await page.waitForLoadState("networkidle");
  // c9 wave1 KNW Slice2: the consensus table's 論点 column now shows a
  // readable post-body excerpt instead of the raw post_id ULID.
  const row = page.locator("tr", { hasText: "first post" });
  await expect(row).toBeVisible();
  await expect(row.locator("td").nth(1)).toHaveText("1"); // agree count

  // 5. 磨き第2弾#3: 「この投稿を相談室へ」 is folded into a per-post kebab (⋮)
  //    menu — hidden until opened, not a permanently-visible button.
  const seedAfterReload = page.locator(`article[data-post-id="${postId}"]`);
  await expect(seedAfterReload.getByRole("button", { name: "この投稿を相談室へ" })).not.toBeVisible();
  await seedAfterReload.getByRole("button", { name: "この投稿の操作" }).click();
  await expect(seedAfterReload.getByRole("button", { name: "この投稿を相談室へ" })).toBeVisible();

  // 6. thread-starter resolve mark toggles without a full page navigation
  //    (local refetch) and flips the visible copy + button label.
  await page.getByRole("button", { name: "✔ 解決済みにする" }).click();
  // exact:true — "✔ 解決済み" is a literal substring of the pre-click button's
  // OWN label ("✔ 解決済みにする"), so a loose match could pass on stale state.
  await expect(page.getByText("✔ 解決済み", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "解決を取り消す" })).toBeVisible();
});
