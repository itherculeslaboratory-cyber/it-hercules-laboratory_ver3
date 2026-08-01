// V3-OBS-47 — 撮影直後のローカル解析(HSV/Lab色空間・輪郭・サイズ推定)。
// x_ihl_req: V3-OBS-47
// 制約(発注書 ORDER-2026-08-01-w-web1): package.json 不可侵のため OpenCV.js 等は使わず、
// ブラウザ標準API相当のピクセル配列だけで書ける範囲(色空間変換+Otsu二値化による輪郭bboxの
// 簡易サイズ推定)に限定する。value_origin(自動計測/手入力)のfrozen enumゲート自体は
// tests/obs-annotations.test.ts で既にサーバ側実装・テスト済み(progress.json note参照)であり
// 本ファイルはその入力元になる「ローカル解析」の計算部分のみを担う。

import type { PixelBuffer } from "./corner-detection";

// g80-e2color(b3think §3-3): 撮影経路でのクライアントLab焼き込み。重い画素処理は
// クライアント側(ブラウザ)で完結させる(V3-AIP-104/invariant①)。ここから下は
// DOM API(createImageBitmap/OffscreenCanvas)に依存するため、上のanalyzeRegionColor等
// (DOM非依存・vitestでテスト可能)とは分けている。

export interface Hsv {
  h: number; // 0-360
  s: number; // 0-1
  v: number; // 0-1
}

export interface Lab {
  l: number; // 0-100
  a: number; // 概ね -128..127
  b: number; // 概ね -128..127
}

/** sRGB(0-255) → HSV。 */
export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
    else h = 60 * ((rn - gn) / delta + 4);
  }
  if (h < 0) h += 360;

  const s = max === 0 ? 0 : delta / max;
  const v = max;
  return { h, s, v };
}

/** sRGB(0-255) → CIE Lab(D65白色点)。sRGB→線形RGB→XYZ→Labの標準変換。 */
export function rgbToLab(r: number, g: number, b: number): Lab {
  const toLinear = (c: number): number => {
    const cn = c / 255;
    return cn <= 0.04045 ? cn / 12.92 : Math.pow((cn + 0.055) / 1.055, 2.4);
  };
  const rl = toLinear(r);
  const gl = toLinear(g);
  const bl = toLinear(b);

  // sRGB(D65) -> XYZ
  const x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175;
  const z = rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041;

  // D65 白色点で正規化
  const xn = x / 0.95047;
  const yn = y / 1.0;
  const zn = z / 1.08883;

  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(xn);
  const fy = f(yn);
  const fz = f(zn);

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

export interface RegionColorStats {
  meanHsv: Hsv;
  meanLab: Lab;
  pixelCount: number;
}

/** 矩形領域の平均HSV/平均Labを算出する(色相は円環平均=ベクトル平均で求める)。 */
export function analyzeRegionColor(
  pixels: PixelBuffer,
  region: { x: number; y: number; width: number; height: number },
): RegionColorStats | null {
  const { data, width } = pixels;
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(pixels.width, x0 + Math.floor(region.width));
  const y1 = Math.min(pixels.height, y0 + Math.floor(region.height));
  if (x1 <= x0 || y1 <= y0) return null;

  let sumS = 0;
  let sumV = 0;
  let sumHx = 0; // cos(h) 累積(円環平均用)
  let sumHy = 0; // sin(h) 累積
  let sumL = 0;
  let sumA = 0;
  let sumB = 0;
  let count = 0;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const bch = data[idx + 2];
      const hsv = rgbToHsv(r, g, bch);
      const lab = rgbToLab(r, g, bch);
      const rad = (hsv.h * Math.PI) / 180;
      sumHx += Math.cos(rad);
      sumHy += Math.sin(rad);
      sumS += hsv.s;
      sumV += hsv.v;
      sumL += lab.l;
      sumA += lab.a;
      sumB += lab.b;
      count++;
    }
  }
  if (count === 0) return null;

  let meanH = (Math.atan2(sumHy / count, sumHx / count) * 180) / Math.PI;
  if (meanH < 0) meanH += 360;

  return {
    meanHsv: { h: meanH, s: sumS / count, v: sumV / count },
    meanLab: { l: sumL / count, a: sumA / count, b: sumB / count },
    pixelCount: count,
  };
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Otsu の二値化しきい値を輝度ヒストグラム(256階調)から求める。
 * 前景/背景のクラス間分散を最大化するしきい値。
 */
export function otsuThreshold(pixels: PixelBuffer): number {
  const { data, width, height } = pixels;
  const hist = new Array<number>(256).fill(0);
  const total = width * height;
  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const lum = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
    hist[Math.min(255, Math.max(0, lum))]++;
  }

  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];

  let sumB = 0;
  let wB = 0;
  let maxVariance = 0;
  // 複数の t が同じ最大クラス間分散を持つ場合(2クラスタが離れているほど頻出)、
  // 最初の t だけを取ると暗クラスタの輝度値そのものと一致してしまい、
  // その輝度値を持つ画素が「暗側」に分類されない境界バグになる。
  // 標準的な回避策として、最大値を達成する t 群の平均を閾値とする。
  let bestSum = 0;
  let bestCount = 0;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) * (mB - mF);
    if (variance > maxVariance + 1e-9) {
      maxVariance = variance;
      bestSum = t;
      bestCount = 1;
    } else if (Math.abs(variance - maxVariance) <= 1e-9) {
      bestSum += t;
      bestCount++;
    }
  }
  return bestCount === 0 ? 0 : Math.round(bestSum / bestCount);
}

/**
 * Otsu 二値化により被写体(背景より暗い/明るいどちらか少数派)の外接矩形(bbox)を求める。
 * サイズ推定(OBS-47「大きさ」)の入力として使う。被写体画素が無ければ null。
 */
export function estimateSubjectBoundingBox(pixels: PixelBuffer): BoundingBox | null {
  const { data, width, height } = pixels;
  const threshold = otsuThreshold(pixels);

  // 少数派クラスを被写体とみなす(背景=大多数の輝度クラス、という仮定)。
  let darkCount = 0;
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    if (lum < threshold) darkCount++;
  }
  const isSubjectDark = darkCount < width * height - darkCount;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      const isSubjectPixel = isSubjectDark ? lum < threshold : lum >= threshold;
      if (isSubjectPixel) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** File(画像)をピクセル配列に復号する。非画像/デコード失敗はnull(誇張ゼロ・
 *  推測でごまかさない)。ブラウザ標準API(createImageBitmap+OffscreenCanvas)のみ使い、
 *  package.json への新規依存追加は行わない(このファイル冒頭の制約どおり)。 */
export async function decodeFileToPixels(file: File): Promise<PixelBuffer | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return { data: imageData.data, width: imageData.width, height: imageData.height };
  } catch {
    return null;
  }
}

/** BPCMS payload の region 記述子。V3-UIX-40(スポイト/px指定ROI選択UI)は本発注の
 *  スコープ外のため、当面は写真全体平均のみを送る。 */
export const CAPTURE_COLOR_REGION_FULL = "full";
/** POST /observation/{capture_id}/color の source フィールド(アップロード時自動計算)。 */
export const CAPTURE_COLOR_SOURCE_AUTO = "client_upload_auto";

export interface CaptureColorPayload {
  lab: Lab;
  hsv: Hsv;
  region: string;
  source: string;
}

/**
 * アップロードされた写真ファイルから、写真全体の平均Lab/HSVを算出する
 * (g80-e2color: analyzeRegionColorの呼び出し配線)。グレーカードの自動検出は
 * このリポジトリに存在せず(V3-UIX-40のROI選択UIが前提・本発注のスコープ外)、
 * よってcorrectLabViaGreycardによる補正はここでは適用しない — 生Lab
 * (observation-constants.tsのコメント「生画像は無補正のまま保存」と矛盾しない、
 * 補正は後続の別レイヤーとして残せる)をそのまま返す。デコード失敗時はnull。
 */
export async function computeCaptureColorPayload(file: File): Promise<CaptureColorPayload | null> {
  const pixels = await decodeFileToPixels(file);
  if (!pixels) return null;
  const stats = analyzeRegionColor(pixels, { x: 0, y: 0, width: pixels.width, height: pixels.height });
  if (!stats) return null;
  return {
    lab: stats.meanLab,
    hsv: stats.meanHsv,
    region: CAPTURE_COLOR_REGION_FULL,
    source: CAPTURE_COLOR_SOURCE_AUTO,
  };
}
