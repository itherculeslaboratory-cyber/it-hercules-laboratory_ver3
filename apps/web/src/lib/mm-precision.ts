// V3-OBS-53 (mm精度算出) / V3-OBS-45 (スケール紙較正)
// x_ihl_source: apps/api/src/observation-constants.ts の calibratedRealLengthMm/SCALE_PAPER
// が単一正本(design-obs-53-mm-precision-scale.md §1 で「実装済み」と明記済み)。
// apps/web と apps/api は別npmパッケージで、package.json は本ラウンド不可侵のため
// workspace依存を新規に足せない。ゆえに式をここへ複製する(ロジックは同一・改変禁止)。

/** スケール紙のマーカー物理寸法(mm)。apps/api の SCALE_PAPER.marker_mm と同値。 */
export const SCALE_PAPER_MARKER_MM = 10;

/**
 * OBS-45/53 pixel→mm 較正: realLength = pixelLength × mmPerPixel、
 * mmPerPixel はスケール紙マーカーの既知物理寸法(markerRealMm)を
 * マーカーのピクセル長(markerPixelLength)で割って導出する。
 * markerPixelLength <= 0 や非有限値では null を返す(誇張ゼロ・でたらめな換算を作らない)。
 */
export function calibratedRealLengthMm(
  pixelLength: number,
  markerPixelLength: number,
  markerRealMm: number = SCALE_PAPER_MARKER_MM,
): number | null {
  if (!Number.isFinite(markerPixelLength) || markerPixelLength <= 0) return null;
  if (!Number.isFinite(pixelLength)) return null;
  const mmPerPixel = markerRealMm / markerPixelLength;
  return pixelLength * mmPerPixel;
}
