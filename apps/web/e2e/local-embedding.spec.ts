import { test, expect } from "@playwright/test";
import { localHashEmbedding, cosineSimilarity } from "../src/lib/local-embedding";

// V3-WIK-23 — 検索・embedding計算をユーザー端末上でローカル実行する(要件の一部)。
// ★スコープ注記(src/lib/local-embedding.ts 参照): ここで検証するのは
// 「新規npm依存ゼロ・端末内完結・ネットワーク不要」というプレースホルダの配線であり、
// MiniLM/e5-small相当の意味的embedding(ONNX Runtime Web・別途スコープ)ではない。

test("localHashEmbedding runs on-device in a real browser with zero network requests (V3-WIK-23 placeholder)", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));

  await page.exposeFunction("__embed", (text: string) => Promise.resolve(Array.from(localHashEmbedding(text))));

  await page.goto("about:blank");
  await page.setContent(`<main><button type="button">embed</button><p id="result"></p></main>`);
  await page.evaluate(() => {
    const btn = document.querySelector("button")!;
    const out = document.getElementById("result")!;
    btn.addEventListener("click", async () => {
      const v = await (window as unknown as { __embed: (t: string) => Promise<number[]> }).__embed(
        "カブトムシの標本",
      );
      out.textContent = String(v.length);
    });
  });

  const before = requests.length;
  await page.getByRole("button", { name: "embed" }).click();

  await expect(page.locator("#result")).toHaveText("64");
  expect(requests.length).toBe(before); // 端末内完結 = 追加のネットワークリクエスト0件
});

test("cosineSimilarity ranks similar text higher than unrelated text (real module, real assertion)", () => {
  const a = localHashEmbedding("カブトムシの角の長さを測定した");
  const b = localHashEmbedding("カブトムシの角を測定して記録した");
  const c = localHashEmbedding("今日の天気は晴れで気温が高い");
  expect(cosineSimilarity(a, b)).toBeGreaterThan(cosineSimilarity(a, c));
});
