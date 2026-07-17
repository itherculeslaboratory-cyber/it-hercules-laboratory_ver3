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

/** V3-UIX-21: 検索結果への好み(preference)ブレンド比率。OBS-11 の compositeScore
 * (embedding/color/size/lineage・ADR-H-12・sum=1.0)は変更せず、その結果へ追加で
 * 上書きブレンドする独立レイヤーとして personalize=true 時のみ効かせる(既定 rerank
 * 挙動を壊さない・ADR 再交渉なし)。finalScore = (1-w)·compositeScore + w·preference。 */
export const PERSONALIZE_WEIGHT = 0.25;

/** allowed QR batch sizes (IND-15). */
export const QR_BATCH_SIZES = [100, 500, 1000] as const;

/** stage→next-observation interval in days (OBS-21 example values). */
export const SCHEDULE_STAGE_INTERVAL_DAYS = {
  first_to_second: 30,
  second_to_third: 30,
} as const;

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
