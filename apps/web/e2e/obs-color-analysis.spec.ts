import { test, expect } from "@playwright/test";
import { rgbToHsv, analyzeRegionColor, estimateSubjectBoundingBox, type BoundingBox } from "../src/lib/color-analysis";
import type { PixelBuffer } from "../src/lib/corner-detection";

// V3-OBS-47 — 撮影直後のローカル解析(HSV/Lab色空間・サイズ推定)。
// 実ブラウザ(Chromium)の Canvas 2D API で被写体を描き、getImageData() で得た本物の
// ImageData を実モジュール(vitestで検証済みの同一コード)へ渡して色解析+サイズ推定を行う。
// 要件が求める「撮った瞬間に端末でローカル解析」をネットワークリクエスト0件で確認する。

test("analyzes color + subject bounding box from a real Canvas ImageData (V3-OBS-47)", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));

  await page.goto("about:blank");
  const before = requests.length;

  await page.exposeFunction("__analyze", (data: number[], width: number, height: number) => {
    const pixels: PixelBuffer = { data: new Uint8ClampedArray(data), width, height };
    const bbox = estimateSubjectBoundingBox(pixels);
    const region = bbox ?? { x: 0, y: 0, width, height };
    const colorStats = analyzeRegionColor(pixels, region);
    return { bbox, meanHsv: colorStats?.meanHsv ?? null };
  });

  await page.setContent(`<canvas id="c" width="40" height="40"></canvas>`);
  const result = await page.evaluate(async () => {
    const canvas = document.getElementById("c") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgb(240,240,240)"; // 明るい背景
    ctx.fillRect(0, 0, 40, 40);
    ctx.fillStyle = "rgb(200,30,30)"; // 赤系の被写体(標本を模した色)
    ctx.fillRect(10, 12, 15, 10);

    const imageData = ctx.getImageData(0, 0, 40, 40);
    const analyze = (window as unknown as {
      __analyze: (
        data: number[],
        width: number,
        height: number,
      ) => Promise<{ bbox: BoundingBox | null; meanHsv: { h: number; s: number; v: number } | null }>;
    }).__analyze;
    return analyze(Array.from(imageData.data), imageData.width, imageData.height);
  });

  expect(result.bbox).toEqual({ x: 10, y: 12, width: 15, height: 10 });
  const expectedHue = rgbToHsv(200, 30, 30).h;
  expect(result.meanHsv).not.toBeNull();
  expect(result.meanHsv!.h).toBeCloseTo(expectedHue, 1);

  expect(requests.length).toBe(before); // ローカル解析 = 追加のネットワークリクエスト0件
});
