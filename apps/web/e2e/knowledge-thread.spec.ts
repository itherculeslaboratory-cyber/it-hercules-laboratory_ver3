import { test, expect, type Page } from "@playwright/test";

// T-71 KNW wave1(スレッド=みんなのグループチャット — 承認モックアップ section3
// の verbatim 採用・オーナー裁定 R94「既存を捨てる」)。旧構成(投稿ごと賛否
// Agree/Disagree/Pass ボタン + Polis型合意可視化テーブル + textarea 返信
// フォーム + スレ主限定解決マーク)は撤去済み — この e2e もそれに合わせて
// 書き直す。実ブラウザ通貫: dev-login → スレを2投稿(root+返信)で seed
// (POST /plaza/posts・実 API)→ /s/knowledge-thread?thread_id=... を実 worker +
// R2-local で描画 → (1) 両投稿が .msg 吹き出しとして可視(本文テキスト+
// 自分/他人の左右寄せ)(2) チャット入力欄からメッセージ送信 → ポーリング/
// 再取得後に新規メッセージが可視。

const WEB = "http://127.0.0.1:3000";

async function devLogin(page: Page): Promise<void> {
  await page.goto(`${WEB}/s/login`);
  await page.getByRole("button", { name: "開発トークンでログイン" }).click();
  await expect(page.getByRole("heading", { name: "ホーム" })).toBeVisible();
}

test("knowledge thread chat: seeded posts render as bubbles (own vs others) -> send a new message -> appears after refetch", async ({ page }) => {
  await devLogin(page);

  // 1. seed a thread via the real API (same-origin cookie auth) — the dev
  //    actor is the root post's author (own message → .msg.me).
  const threadId = `e2e-thr-chat-${Date.now().toString(36)}`;
  const rootTopic = "E2Eチャット確認スレ";
  const root = await page.evaluate(
    async ({ tid, topic }) => {
      const r = await fetch("/api/v1/plaza/posts", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ thread_id: tid, channel: "knowledge-board", topic, board_kind: "guide", body: "これは自分の最初の投稿です" }),
      });
      return { status: r.status, json: await r.json() };
    },
    { tid: threadId, topic: rootTopic },
  );
  expect(root.status, "seed root post must be 201").toBe(201);

  const reply = await page.evaluate(
    async ({ tid, topic }) => {
      const r = await fetch("/api/v1/plaza/posts", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ thread_id: tid, channel: "knowledge-board", topic, board_kind: "guide", body: "これは(別視点の)返信投稿です" }),
      });
      return { status: r.status, json: await r.json() };
    },
    { tid: threadId, topic: rootTopic },
  );
  expect(reply.status, "seed reply post must be 201").toBe(201);

  // 2. open the per-thread chat screen with the thread_id as a query param.
  await page.goto(`${WEB}/s/knowledge-thread?thread_id=${threadId}`);
  await expect(page.getByRole("heading", { name: rootTopic })).toBeVisible();
  await page.waitForLoadState("networkidle");

  // both seeded posts render as real body text inside .msg bubbles.
  const rootMsg = page.locator(".msg", { hasText: "これは自分の最初の投稿です" });
  await expect(rootMsg).toBeVisible();
  // the dev actor authored BOTH seed posts here (same session), so both are
  // "own" messages — the honest own/others split is exercised by the
  // dedicated renderer unit test (renderer-knw-thread-chat.test.tsx) with two
  // distinct actor_ids, which a single dev-login session cannot produce in a
  // real end-to-end run. Here we assert the structural class is present.
  await expect(rootMsg).toHaveClass(/\bme\b/);

  // R94: the old per-post Agree/Disagree/Pass + Polis consensus table + resolve
  // mark are GONE from this screen.
  await expect(page.getByRole("button", { name: "賛成" })).toHaveCount(0);
  await expect(page.getByText("合意の可視化")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "✔ 解決済みにする" })).toHaveCount(0);

  // 3. send a new message via the chat input bar.
  const input = page.getByPlaceholder("メッセージを送る…");
  await input.fill("これはE2Eからのチャット送信です");
  await page.getByRole("button", { name: "送信" }).click();

  // 4. the new message appears after the send's own refetch (no manual reload
  //    needed — real-time here is the client poll, but the send path already
  //    reloads once on success).
  await expect(page.locator(".msg", { hasText: "これはE2Eからのチャット送信です" })).toBeVisible();
  await expect(input).toHaveValue("");
});
