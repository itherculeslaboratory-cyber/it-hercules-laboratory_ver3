// GENERATED FILE — do not edit by hand.
// source: schemas/evaluation-axis.schema.json
// title: Evaluation axis (3-layer)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 評価軸 3 層。common（満足度/再利用などの既定軸）・purpose（用途別）・custom（野生の天才定義）の 3 配列。culture-template kind=eval_axis の body 契約でもある（V3-AIP-76）。
 */
export interface EvaluationAxis {
  /**
   * 既定軸（満足度/再利用など）。
   */
  common: string[];
  /**
   * 用途別軸。
   */
  purpose: string[];
  /**
   * 自由定義軸（野生の天才定義）。
   */
  custom: string[];
}
