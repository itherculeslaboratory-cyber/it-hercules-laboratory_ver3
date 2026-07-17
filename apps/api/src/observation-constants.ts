// C5 K1 frozen constants — single source of truth for observation/individual
// tuning values. Scatter these as literals across route files and they drift;
// keep them here and every projection reads the same number.
// x_ihl_req: V3-OBS-06/07/09/10/11/20/21/45/56 · V3-IND-07/15
// x_ihl_source: docs/planning/c5/design-k1.md §1.6

/** rerank blend weights (OBS-11 / ADR-H-12). Sum = 1.0. */
export const RERANK_WEIGHTS = {
  embedding: 0.5,
  color: 0.2,
  size: 0.2,
  lineage: 0.1,
} as const;

/** default score for a missing rerank component (OBS-11). */
export const RERANK_MISSING = { color: 0.5, size: 0.5, lineage: 0.0 } as const;

/** preference online-learning rate α in w ← w + α·y·x (IND-07). */
export const LEARNING_RATE = 0.1;

/** AUC threshold for a "valid"/converged preference model (IND-08). */
export const MATCH_AUC_VALID_THRESHOLD = 0.7;

/** allowed QR batch sizes (IND-15). */
export const QR_BATCH_SIZES = [100, 500, 1000] as const;

/** stage→next-observation interval in days (OBS-21 example values). */
export const SCHEDULE_STAGE_INTERVAL_DAYS = {
  first_to_second: 30,
  second_to_third: 30,
} as const;

/** current life-event stage (to_stage vocabulary: first/second/third_early/…)
 *  → the SCHEDULE_STAGE_INTERVAL_DAYS transition key for "what's next from here"
 *  (V3-IND-20 スケジュール自動生成). Stages past `second` have no interval yet
 *  (OBS-21 の例示値がここまでしか無い) — 未知は呼び出し側で 400(推測しない)。 */
export const STAGE_TO_NEXT_TRANSITION: Record<string, keyof typeof SCHEDULE_STAGE_INTERVAL_DAYS> = {
  first: "first_to_second",
  second: "second_to_third",
};

/** target-navigator convergence bound: questions to reach a species (OBS-02). */
export const NAVIGATOR_TARGET_QUESTIONS = { min: 7, max: 12 } as const;

/** scale-paper print spec (OBS-45). Physical calibration knob — tolerance_mm is
 *  the real-world print/cut slack, not a code constant to zero out. */
export const SCALE_PAPER = {
  sheet: "A4",
  grid_cm: { w: 19, h: 26 },
  marker_mm: 10,
  qr_mm: 15,
  thin_line_mm: 1,
  thick_line_mm: 10,
  tolerance_mm: 0.2,
} as const;

/** embedding vector dimension (OBS-09/10). Mirrors observation-routes.ts. */
export const EMBEDDING_DIM = 384;

/**
 * OBS-45/53 pixel->mm calibration: realLength = pixelLength × mmPerPixel,
 * where mmPerPixel is derived from the scale paper's KNOWN physical marker
 * size (SCALE_PAPER.marker_mm) measured in pixels. The corner-detection +
 * projective-transform step that PRODUCES markerPixelLength runs client-side
 * (browser Canvas/WASM, OFF the server — V3-AIP-104/invariant①); this function
 * is the shared, pure formula both a client implementation and a test/design
 * doc can point at. Returns null on a degenerate/failed detection
 * (markerPixelLength <= 0) rather than silently producing a bogus scale.
 */
export function calibratedRealLengthMm(
  pixelLength: number,
  markerPixelLength: number,
  markerRealMm: number = SCALE_PAPER.marker_mm,
): number | null {
  if (!Number.isFinite(markerPixelLength) || markerPixelLength <= 0) return null;
  if (!Number.isFinite(pixelLength)) return null;
  const mmPerPixel = markerRealMm / markerPixelLength;
  return pixelLength * mmPerPixel;
}

/**
 * value_origin → confidence grade (OBS-07). Covers ALL 9 frozen provenance
 * value_origin enum values (schemas/frozen/provenance.schema.json) so
 * confidenceGrade() is total and never returns undefined for a valid
 * measurement (批評家#2). Derived origins → ○, estimated/model/aggregate → △.
 */
export const CONFIDENCE_ORDER = {
  direct_observed: "◎",
  image_derived: "○",
  environment_derived: "○",
  lineage_derived: "○",
  estimated: "△",
  imputed: "△",
  aggregate: "△",
  model_inference: "△",
  unknown: "△",
} as const;
