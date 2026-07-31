// V3-OBS-45 — スケール紙(A4方眼19×26cm+四隅マーカー10mm角)の四隅自動検出+射影変換。
// x_ihl_req: V3-OBS-45 / V3-OBS-53
// 制約(発注書 ORDER-2026-08-01-w-web1): apps/web/package.json は不可侵のため新規npmライブラリを
// 追加できない。OpenCV.js は使わず、ブラウザ標準API(ImageData 相当のピクセル配列)だけで書ける
// 範囲に限定した実装。★簡略化の明記: 要件原文が挙げる Canny/Hough は自前実装しておらず、
// マーカーが背景(白紙)に対して暗色である前提のしきい値+重心法で代替している(MVP)。
// 精緻化(真のエッジ検出)は後続waveの持ち越し。

/** ImageData と構造的に互換な最小インターフェース(DOM非依存でテスト可能にするため)。 */
export interface PixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface CornerMarkers {
  topLeft: Point;
  topRight: Point;
  bottomLeft: Point;
  bottomRight: Point;
}

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * 画像の4隅それぞれについて、コーナーから `searchFraction` 分の探索窓内にある
 * 暗色ピクセル(輝度 < darkThreshold)の重心を求め、マーカー中心とみなす。
 * 該当窓に暗色ピクセルが1つも無い隅があれば null を返す(誇張ゼロ・でたらめな座標を作らない)。
 */
export function detectCornerMarkers(
  pixels: PixelBuffer,
  opts: { darkThreshold?: number; searchFraction?: number } = {},
): CornerMarkers | null {
  const darkThreshold = opts.darkThreshold ?? 80;
  const searchFraction = opts.searchFraction ?? 0.35;
  const { data, width, height } = pixels;
  const winW = Math.max(1, Math.floor(width * searchFraction));
  const winH = Math.max(1, Math.floor(height * searchFraction));

  const centroidInWindow = (x0: number, y0: number, x1: number, y1: number): Point | null => {
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const idx = (y * width + x) * 4;
        const lum = luminance(data[idx], data[idx + 1], data[idx + 2]);
        if (lum < darkThreshold) {
          sumX += x;
          sumY += y;
          count++;
        }
      }
    }
    if (count === 0) return null;
    return { x: sumX / count, y: sumY / count };
  };

  const topLeft = centroidInWindow(0, 0, winW, winH);
  const topRight = centroidInWindow(width - winW, 0, width, winH);
  const bottomLeft = centroidInWindow(0, height - winH, winW, height);
  const bottomRight = centroidInWindow(width - winW, height - winH, width, height);

  if (!topLeft || !topRight || !bottomLeft || !bottomRight) return null;
  return { topLeft, topRight, bottomLeft, bottomRight };
}

/** 3x3 射影変換行列(row-major, 9要素・h[8]=1に正規化)。 */
export type Homography = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

/**
 * 4点対応(src→dst)から射影変換(ホモグラフィ)を DLT で求める。
 * src/dst はそれぞれちょうど4点(通常はマーカー中心4点→既知の方眼座標4点)。
 * 8x8 線形方程式をガウス消去法で解く。特異(3点以上が同一直線上など)なら null。
 */
export function computeHomography(src: readonly Point[], dst: readonly Point[]): Homography | null {
  if (src.length !== 4 || dst.length !== 4) return null;

  // Ah = b で h6,h7 以外は正規化済み(h8=1)の8未知数を解く。
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x: sx, y: sy } = src[i];
    const { x: dx, y: dy } = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]);
    b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]);
    b.push(dy);
  }

  const h = solveLinearSystem(A, b);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** ガウス消去法(部分ピボット選択付き)で Ax=b を解く。8x8 専用でなく汎用n次元。 */
function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
    }
    if (Math.abs(M[pivot][col]) < 1e-10) return null; // 特異
    [M[col], M[pivot]] = [M[pivot], M[col]];

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row][col] / M[col][col];
      for (let k = col; k <= n; k++) M[row][k] -= factor * M[col][k];
    }
  }

  return M.map((row, i) => row[n] / row[i]);
}

/** 射影変換を1点へ適用する(同次座標→デカルト座標へ正規化)。 */
export function applyHomography(h: Homography, p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

/** 2点間のユークリッド距離。 */
export function pointDistance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * 射影変換で補正した座標系での2点間距離(px)を求める。
 * OBS-45/53: この値を mm-precision.ts の calibratedRealLengthMm へ渡すことで実寸(mm)を得る。
 */
export function measureCorrectedPixelLength(h: Homography, p1: Point, p2: Point): number {
  return pointDistance(applyHomography(h, p1), applyHomography(h, p2));
}
