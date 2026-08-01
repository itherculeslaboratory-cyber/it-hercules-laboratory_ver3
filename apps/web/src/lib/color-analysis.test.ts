import { describe, it, expect } from "vitest";
import {
  rgbToHsv,
  rgbToLab,
  analyzeRegionColor,
  otsuThreshold,
  estimateSubjectBoundingBox,
  decodeFileToPixels,
  computeCaptureColorPayload,
  CAPTURE_COLOR_REGION_FULL,
  CAPTURE_COLOR_SOURCE_AUTO,
  type BoundingBox,
} from "./color-analysis";
import type { PixelBuffer } from "./corner-detection";

describe("rgbToHsv (V3-OBS-47)", () => {
  it("pure red is h=0 s=1 v=1", () => {
    const hsv = rgbToHsv(255, 0, 0);
    expect(hsv.h).toBeCloseTo(0, 3);
    expect(hsv.s).toBeCloseTo(1, 6);
    expect(hsv.v).toBeCloseTo(1, 6);
  });

  it("pure green is h=120", () => {
    expect(rgbToHsv(0, 255, 0).h).toBeCloseTo(120, 3);
  });

  it("white has s=0", () => {
    const hsv = rgbToHsv(255, 255, 255);
    expect(hsv.s).toBeCloseTo(0, 6);
    expect(hsv.v).toBeCloseTo(1, 6);
  });
});

describe("rgbToLab (V3-OBS-47)", () => {
  it("white maps to L*=100, a*=0, b*=0", () => {
    const lab = rgbToLab(255, 255, 255);
    expect(lab.l).toBeCloseTo(100, 1);
    expect(lab.a).toBeCloseTo(0, 1);
    expect(lab.b).toBeCloseTo(0, 1);
  });

  it("black maps to L*=0", () => {
    const lab = rgbToLab(0, 0, 0);
    expect(lab.l).toBeCloseTo(0, 1);
  });
});

function makeSolidBuffer(width: number, height: number, r: number, g: number, b: number): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

describe("analyzeRegionColor (V3-OBS-47)", () => {
  it("a solid-colour region reports that exact colour as its mean", () => {
    const pixels = makeSolidBuffer(20, 20, 200, 100, 50);
    const stats = analyzeRegionColor(pixels, { x: 0, y: 0, width: 20, height: 20 });
    expect(stats).not.toBeNull();
    const expectedHsv = rgbToHsv(200, 100, 50);
    expect(stats!.meanHsv.h).toBeCloseTo(expectedHsv.h, 3);
    expect(stats!.pixelCount).toBe(400);
  });

  it("returns null for an out-of-bounds / empty region", () => {
    const pixels = makeSolidBuffer(10, 10, 0, 0, 0);
    expect(analyzeRegionColor(pixels, { x: 50, y: 50, width: 10, height: 10 })).toBeNull();
  });
});

describe("otsuThreshold + estimateSubjectBoundingBox (V3-OBS-47 サイズ推定)", () => {
  it("finds the bounding box of a dark subject on a light background", () => {
    const pixels = makeSolidBuffer(40, 40, 240, 240, 240); // light background
    // paint a 10x6 dark subject rectangle
    for (let y = 15; y < 21; y++) {
      for (let x = 12; x < 22; x++) {
        const idx = (y * 40 + x) * 4;
        pixels.data[idx] = 10;
        pixels.data[idx + 1] = 10;
        pixels.data[idx + 2] = 10;
      }
    }
    const bbox = estimateSubjectBoundingBox(pixels) as BoundingBox;
    expect(bbox).not.toBeNull();
    expect(bbox.x).toBe(12);
    expect(bbox.y).toBe(15);
    expect(bbox.width).toBe(10);
    expect(bbox.height).toBe(6);
  });

  it("otsuThreshold sits between two well-separated intensity clusters", () => {
    const pixels = makeSolidBuffer(20, 20, 250, 250, 250);
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 20; x++) {
        const idx = (y * 20 + x) * 4;
        pixels.data[idx] = 5;
        pixels.data[idx + 1] = 5;
        pixels.data[idx + 2] = 5;
      }
    }
    const t = otsuThreshold(pixels);
    expect(t).toBeGreaterThan(5);
    expect(t).toBeLessThan(250);
  });
});

// g80-e2color: decodeFileToPixels/computeCaptureColorPayload はDOM API
// (createImageBitmap+OffscreenCanvas)に依存する。jsdom(このプロジェクトのvitest環境)
// はどちらも実装していないため、実画像デコードそのものはここでは検証できない
// (正直な断り — analyzeRegionColorの計算部分は上のdescribeで既に検証済み)。
// ここで検証するのは「デコード不可でも例外を投げず null を返す」ベストエフォート契約
// (renderer.tsxの呼び出し側がtry/catchで囲まなくても壊れないことの土台)。
describe("decodeFileToPixels / computeCaptureColorPayload (g80-e2color・ベストエフォート契約)", () => {
  it("jsdom環境(createImageBitmapが無い)ではnullを返し、例外を投げない", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "test.jpg", { type: "image/jpeg" });
    await expect(decodeFileToPixels(file)).resolves.toBeNull();
    await expect(computeCaptureColorPayload(file)).resolves.toBeNull();
  });

  it("region/sourceの定数はAPI(observation-routes.ts POST /observation/{id}/color)が期待する値", () => {
    expect(CAPTURE_COLOR_REGION_FULL).toBe("full");
    expect(CAPTURE_COLOR_SOURCE_AUTO).toBe("client_upload_auto");
  });
});
