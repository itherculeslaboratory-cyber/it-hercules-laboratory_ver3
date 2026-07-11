// GENERATED FILE — do not edit by hand.
// source: schemas/events/obs-analysis.schema.json
// title: Observation Analysis data (ihl.obs.analysis.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 再解析結果の append-only イベントの data 部。Truth キー truth/ihl.obs.analysis.v1/<capture_id>-<ulid>.json。再解析は既存 analysis を上書きせず新 analysis_id で append し、delta と correction_semver を記録（元画像は非削除・不変条項③）。is_manual_edit で手動編集と自動解析を区別。
 */
export interface ObsAnalysis {
  /**
   * 解析結果の一意キー（再解析ごとに新規）。
   */
  analysis_id: string;
  /**
   * 対象観測セッションの capture_id。
   */
  capture_id: string;
  /**
   * 解析結果本体（項目→値）。
   */
  results: {
    [k: string]: unknown;
  };
  /**
   * 前回解析との差分（任意）。
   */
  delta?: {
    [k: string]: unknown;
  };
  /**
   * 補正ロジックの semver（再解析の版・delta の意味づけキー）。
   */
  correction_semver: string;
  /**
   * 手動編集なら true、自動再解析なら false。
   */
  is_manual_edit: boolean;
  /**
   * 実行者の actor_id（V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 実行時刻（RFC3339・任意）。
   */
  created_at?: string;
}
