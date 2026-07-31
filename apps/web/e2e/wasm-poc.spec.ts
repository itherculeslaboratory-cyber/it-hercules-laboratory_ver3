import { test, expect } from "@playwright/test";
import { runWasmAddPoc } from "../src/lib/wasm-poc";

// V3-FND-19 — 重い計算をユーザー端末(WASM)へオフロードする最小PoC。
// ugc-translate.spec.ts(V3-I18-06)と同じ手法: 実モジュールを Node 側でimportし、
// page.exposeFunction で実ブラウザ(Chromium)のクリックからそのまま実行させ、
// 実行中に一切のネットワークリクエストが発生しないこと(=端末内完結・サーバ変動費ゼロ)を確認する。
// スコープ注記: これはWASM実行環境の疎通PoCであり、AI推論/ONNX実行の主張はしない
// (apps/web/src/lib/wasm-poc.ts のコメント参照)。

test("runWasmAddPoc runs on-device in a real browser with zero network requests (V3-FND-19)", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));

  await page.exposeFunction("__runWasmAddPoc", (a: number, b: number) => runWasmAddPoc(a, b));

  await page.goto("about:blank");
  await page.setContent(`<main><button type="button">run</button><p id="result"></p></main>`);
  await page.evaluate(() => {
    const btn = document.querySelector("button")!;
    const out = document.getElementById("result")!;
    btn.addEventListener("click", async () => {
      const r = await (window as unknown as {
        __runWasmAddPoc: (a: number, b: number) => Promise<{ sum: number }>;
      }).__runWasmAddPoc(4, 9);
      out.textContent = String(r.sum);
    });
  });

  const before = requests.length;
  await page.getByRole("button", { name: "run" }).click();

  await expect(page.locator("#result")).toHaveText("13");
  expect(requests.length).toBe(before); // オフロード成立 = 追加のネットワークリクエスト0件
});
