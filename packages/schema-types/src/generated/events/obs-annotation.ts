// GENERATED FILE — do not edit by hand.
// source: schemas/events/obs-annotation.schema.json
// title: Observation Annotation data (ihl.obs.annotation.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 画像アノテーション（LabelMe AST）の append-only イベントの data 部。Truth キー truth/ihl.obs.annotation.v1/<capture_id>-<ulid>.json。ast は点／線／polygon／label を持つ開いた構造（LabelMe 由来・postMessage 契約で受領）。手入力値は value_origin を付与、自動計測値は上書き不可（append-only・不変条項③）。iframe/CV 実体は後波。
 */
export interface ObsAnnotation {
  /**
   * アノテーションの一意キー。
   */
  annotation_id: string;
  /**
   * 対象観測セッションの capture_id。
   */
  capture_id: string;
  /**
   * LabelMe アノテーション AST（点／線／polygon／label 等・開いた構造）。
   */
  ast: {
    [k: string]: unknown;
  };
  /**
   * 計測値の出所（frozen provenance value_origin 9 値・任意。手入力タグ付与時に付す）。
   */
  value_origin?:
    | "direct_observed"
    | "image_derived"
    | "environment_derived"
    | "lineage_derived"
    | "estimated"
    | "imputed"
    | "aggregate"
    | "model_inference"
    | "unknown";
  /**
   * 記録者の actor_id（V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 記録時刻（RFC3339・任意）。
   */
  created_at?: string;
}
