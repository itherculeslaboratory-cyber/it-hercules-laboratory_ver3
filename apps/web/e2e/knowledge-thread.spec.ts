import { test, expect, type Page } from "@playwright/test";

// C7 T1 — 知の広場 per-thread ビューの実ブラウザ通貫。dev-login → スレを1本作成
// (POST /plaza/posts で thread_id/topic を確定) → /s/knowledge-thread?thread_id=... を
// 実 worker + R2-local で描画 → (1) スレ頭カード(topic)と投稿 list が実 API 値を綴じて
// 可視 (2) stance を投じ consensus 投影(Agree/Disagree/Pass の決定論集計)が画面に反映。
// 単一スレ画面が「動く」ことの実測エビデンス(V3-AIP-101)。

const WEB = "http://127.0.0.1:3000";

async function devLogin(page: Page): Promise<void> {
  await page.goto(`${WEB}/s/login`);
  await page.getByRole("button", { name: "開発トークンでログイン" }).click();
  await expect(page.getByRole("heading", { name: "観測ホーム" })).toBeVisible();
}

test("knowledge thread: post a thread then view posts and consensus per-thread", async ({ page }) => {
  await devLogin(page);

  // 1. seed a thread via the real API (same-origin cookie auth). A post carries
  //    its thread_id + topic; that thread_id is what the per-thread screen reads.
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

  // head card (topic) + post list bind real projection values to screen text.
  await expect(page.getByText("話題: E2E consensus check（チャンネル knowledge-board）")).toBeVisible();
  await expect(page.getByText(new RegExp(`${postId}: first post`))).toBeVisible();

  // 3. cast a stance on the seed post; the consensus projection recounts and the
  //    statement line shows agree 1 (deterministic Polis-style tally, no LLM).
  const stance = await page.evaluate(async (sid) => {
    const r = await fetch("/api/v1/plaza/stances", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ statement_id: sid, value: "agree" }),
    });
    return r.status;
  }, postId);
  expect(stance, "stance append must be 201").toBe(201);

  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(new RegExp(`${postId}: 賛成 1 / 反対 0 / 保留 0`))).toBeVisible();
});
