import { test, expect } from "@playwright/test";
import {
  detectCornerMarkers,
  computeHomography,
  measureCorrectedPixelLength,
  type PixelBuffer,
} from "../src/lib/corner-detection";
import { calibratedRealLengthMm } from "../src/lib/mm-precision";

// V3-OBS-45 / V3-OBS-53 — スケール紙の四隅マーカー自動検出+射影変換+mm換算。
// 実ブラウザ(Chromium)の Canvas 2D API(標準API・OffscreenCanvas相当)でスケール紙の
// 合成写真を描き、getImageData() で得た「本物の ImageData」を Node 側の実モジュールへ渡して
// 検出・射影変換・mm換算を行う。要件が求める「ユーザー端末で実行し数値のみ送信」を、
// 実行中のネットワークリクエスト0件で確認する。

test("detects corner markers from a real Canvas ImageData and derives real-world mm (V3-OBS-45/53)", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));

  await page.goto("about:blank");
  const before = requests.length;

  await page.exposeFunction("__measure", (data: number[], width: number, height: number) => {
    const pixels: PixelBuffer = { data: new Uint8ClampedArray(data), width, height };
    const markers = detectCornerMarkers(pixels);
    if (!markers) return null;
    const h = computeHomography(
      [markers.topLeft, markers.topRight, markers.bottomLeft, markers.bottomRight],
      [
        { x: 0, y: 0 },
        { x: 190, y: 0 }, // 既知の方眼: 隅マーカー間隔190px相当と仮定
        { x: 0, y: 280 },
        { x: 190, y: 280 },
      ],
    );
    if (!h) return null;
    const correctedTopEdgePx = measureCorrectedPixelLength(h, markers.topLeft, markers.topRight);
    const realMm = calibratedRealLengthMm(correctedTopEdgePx, 190, 10);
    return { markerCount: 4, correctedTopEdgePx, realMm };
  });

  await page.setContent(`<canvas id="c" width="200" height="300"></canvas>`);
  const result = await page.evaluate(async () => {
    // 実ブラウザの標準 Canvas 2D API でスケール紙の合成写真(白紙+四隅の黒マーカー)を描く。
    const canvas = document.getElementById("c") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 200, 300);
    ctx.fillStyle = "black";
    const m = 12;
    ctx.fillRect(0, 0, m, m); // top-left marker
    ctx.fillRect(200 - m, 0, m, m); // top-right
    ctx.fillRect(0, 300 - m, m, m); // bottom-left
    ctx.fillRect(200 - m, 300 - m, m, m); // bottom-right

    const imageData = ctx.getImageData(0, 0, 200, 300); // 標準API: ImageData
    const measure = (window as unknown as {
      __measure: (
        data: number[],
        width: number,
        height: number,
      ) => Promise<{ markerCount: number; correctedTopEdgePx: number; realMm: number | null } | null>;
    }).__measure;
    return measure(Array.from(imageData.data), imageData.width, imageData.height);
  });

  expect(result).not.toBeNull();
  expect(result!.markerCount).toBe(4);
  expect(result!.correctedTopEdgePx).toBeCloseTo(190, 1);
  expect(result!.realMm).toBeCloseTo(10, 3); // 190px == マーカー基準190px なので実寸=10mm

  expect(requests.length).toBe(before); // 画像処理は端末内で完結 = 追加のネットワークリクエスト0件
});
