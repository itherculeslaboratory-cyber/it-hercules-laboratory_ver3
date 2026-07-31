import { describe, it, expect } from "vitest";
import {
  detectCornerMarkers,
  computeHomography,
  applyHomography,
  measureCorrectedPixelLength,
  type PixelBuffer,
} from "./corner-detection";

/** Build a WxH white PixelBuffer, then paint an NxN black square at (x,y). */
function makeWhiteBuffer(width: number, height: number): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  return { data, width, height };
}

function paintSquare(pixels: PixelBuffer, x: number, y: number, size: number): void {
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const px = x + dx;
      const py = y + dy;
      if (px < 0 || py < 0 || px >= pixels.width || py >= pixels.height) continue;
      const idx = (py * pixels.width + px) * 4;
      pixels.data[idx] = 0;
      pixels.data[idx + 1] = 0;
      pixels.data[idx + 2] = 0;
      pixels.data[idx + 3] = 255;
    }
  }
}

describe("detectCornerMarkers (V3-OBS-45)", () => {
  it("finds four dark markers painted near the image corners", () => {
    const W = 200;
    const H = 300;
    const pixels = makeWhiteBuffer(W, H);
    const markerSize = 12;
    paintSquare(pixels, 0, 0, markerSize); // top-left
    paintSquare(pixels, W - markerSize, 0, markerSize); // top-right
    paintSquare(pixels, 0, H - markerSize, markerSize); // bottom-left
    paintSquare(pixels, W - markerSize, H - markerSize, markerSize); // bottom-right

    const markers = detectCornerMarkers(pixels);
    expect(markers).not.toBeNull();
    expect(markers!.topLeft.x).toBeLessThan(markerSize + 1);
    expect(markers!.topLeft.y).toBeLessThan(markerSize + 1);
    expect(markers!.bottomRight.x).toBeGreaterThan(W - markerSize - 1);
    expect(markers!.bottomRight.y).toBeGreaterThan(H - markerSize - 1);
  });

  it("returns null when a corner has no dark marker (blank white page)", () => {
    const pixels = makeWhiteBuffer(100, 100);
    expect(detectCornerMarkers(pixels)).toBeNull();
  });
});

describe("computeHomography + applyHomography (V3-OBS-45 射影変換)", () => {
  it("identity mapping when src == dst", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ];
    const h = computeHomography(pts, pts);
    expect(h).not.toBeNull();
    const mapped = applyHomography(h!, { x: 42, y: 17 });
    expect(mapped.x).toBeCloseTo(42, 6);
    expect(mapped.y).toBeCloseTo(17, 6);
  });

  it("corrects a skewed quadrilateral back to a square, recovering true distances", () => {
    // The scale paper's marker corners appear skewed in the photo (perspective) but
    // are known to form an exact 200x300 rectangle in reality.
    const src = [
      { x: 10, y: 5 }, // photographed top-left
      { x: 210, y: 20 }, // photographed top-right
      { x: 0, y: 300 }, // photographed bottom-left
      { x: 190, y: 320 }, // photographed bottom-right
    ];
    const dst = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 0, y: 300 },
      { x: 200, y: 300 },
    ];
    const h = computeHomography(src, dst);
    expect(h).not.toBeNull();

    // Each src corner should map exactly onto its dst corner.
    for (let i = 0; i < 4; i++) {
      const mapped = applyHomography(h!, src[i]);
      expect(mapped.x).toBeCloseTo(dst[i].x, 3);
      expect(mapped.y).toBeCloseTo(dst[i].y, 3);
    }

    // Distance between the two photographed top corners, in corrected space,
    // should equal the true 200px top-edge length.
    const correctedLength = measureCorrectedPixelLength(h!, src[0], src[1]);
    expect(correctedLength).toBeCloseTo(200, 3);
  });

  it("returns null for degenerate (collinear) point sets", () => {
    const collinear = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ];
    const dst = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ];
    expect(computeHomography(collinear, dst)).toBeNull();
  });
});
