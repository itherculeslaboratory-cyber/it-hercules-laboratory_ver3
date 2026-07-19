import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

// V3-AIP-49 / C7-T1 — 経済ステータス（残高）実 UI + 実バックエンド E2E. observation.spec
// の作法: in-screen dev-login → ScreenDef Renderer が REAL economy-status を描画 → 残高
// （カルマ二層 + プラチナ）を実 worker + R2-local から本人スコープ投影で読み戻す。
// 台帳は append-only Truth（CL-12）: 投影は都度再計算、常駐 DB 無し（不変条項①）。
//
// economy-status の残高カードは props.bind_text で値を綴じる。C7-T2 で Renderer に
// 汎用 card bind_text（source_path 応答オブジェクトへ {{field}} を綴じる list bind_items
// の単一オブジェクト版）を実装済み。よって本 spec は (1) 残高が UI と同一 same-origin
// cookie で REAL /api/v1/me/ledger から本人スコープで読み戻ること、(2) その値がカルマ
// カードとして画面テキストに可視であること の双方を実測する（批評家指摘「カード値描画を
// 守る自動 assert が無い」の解消）。
//
// 依存ゲート解除: economy-status.json は C5 で恒久存在（navigation.json 収録）。旧 skip
// （K4 未産出待ち）は解消済み。

const WEB = "http://127.0.0.1:3000";
const SPEC_DIR = dirname(fileURLToPath(import.meta.url));
const STATUS_DEF = resolve(SPEC_DIR, "..", "..", "..", "screen-defs", "economy-status.json");

async function devLogin(page: Page): Promise<void> {
  await page.goto(`${WEB}/s/login`);
  await page.getByRole("button", { name: "開発トークンでログイン" }).click();
  await expect(page.getByRole("heading", { name: "ホーム" })).toBeVisible();
}

test("economy status: dev-login then balance reads back through the real worker", async ({ page }) => {
  expect(existsSync(STATUS_DEF), "economy-status.json must exist (C5 dependency)").toBe(true);

  await devLogin(page);

  // 実 UI: the Renderer draws the REAL economy-status screen-def.
  await page.goto(`${WEB}/s/economy-status`);
  await expect(page.getByRole("heading", { name: "ステータス", level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");

  // 残高表示（read-through）: the ledger projection recomputes from append-only
  // Truth and is served under the browser session cookie (本人スコープ・V3-AUT-17).
  const ledger = await page.evaluate(async () => {
    const r = await fetch("/api/v1/me/ledger", { credentials: "include" });
    return { status: r.status, json: await r.json() };
  });
  expect(ledger.status, "authenticated ledger read must be 200").toBe(200);
  const bal = ledger.json as {
    actor_id: string;
    karma_value: number;
    karma_count: number;
    platinum_coins: number;
  };
  expect(typeof bal.actor_id).toBe("string");
  expect(typeof bal.karma_value).toBe("number");
  expect(typeof bal.karma_count).toBe("number");
  expect(typeof bal.platinum_coins).toBe("number");

  // カード値描画の可視 assert: bind_text がカルマカードとして実 API 値を画面に描く。
  await expect(
    page.getByText(
      `値 ${bal.karma_value} / 累積カウント ${bal.karma_count} / プラチナ ${bal.platinum_coins}`,
    ),
  ).toBeVisible();

  // 貢献度 3 軸 list（axis_list bind）が画面に出る — object を .map して白画面化した T1
  // クラッシュの回帰止め。research/capital/development の 3 行が必ず描画される。
  for (const axis of ["research", "capital", "development"]) {
    await expect(page.getByText(new RegExp(`${axis}: \\d`))).toBeVisible();
  }
});
