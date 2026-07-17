// GENERATED FILE — do not edit by hand.
// source: schemas/events/condition.schema.json
// title: Paper condition P entry (PPR-02)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 論文の条件P(P⇒Qの前提)を構成する単一観点キーの閾値仕様(単一正本)。マッチアルゴリズム(paper-match.ts matchConditions/autoFillDescriptor)とcontent.schema.json(paper conditions)の両方がこのファイルだけを参照する(複製しない)。観点キー自体はcontent.schema.json側でオブジェクトのプロパティ名として持つ(このスキーマは1エントリの値側の形)。
 */
export interface Condition {
  min?: number;
  max?: number;
  eq?: number;
  required: boolean;
  unit?: string;
}
