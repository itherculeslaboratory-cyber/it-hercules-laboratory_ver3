// GENERATED FILE — do not edit by hand.
// source: schemas/frozen/provenance.schema.json
// title: Truth Provenance Meta (CL-02)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * Truth レコードの再現性メタ。既存レコードに付与済みのフィールド契約で、スキーマ変更は既存 replay を壊す（要件定義書 CL-02 / V3-FND-15）。ver2 の provenance 断片に value_origin（計測値・埋め込みの出所）を加えた凍結形。envelope.schema.json の provenance 拡張とは別層（frozen/README.md 参照）。
 */
export interface Provenance {
  /**
   * この値を生成したパイプライン run の ID。再現性の一次キー。
   */
  run_id: string;
  /**
   * レコードのスキーマ版。破壊的変更は +1（append-only なので既存イベントは書き換えない）。
   */
  schema_version: number;
  /**
   * 入力（画像バイト列・元イベント等）のハッシュ。決定論的再生成の突合キー。
   */
  input_hash: string;
  created_at: string;
  /**
   * 計測値・集計値・埋め込みの出所（schemas/dictionaries/value_origin.yaml 正本）。measurement / embedding を伴うイベントにのみ付与。値は append-only 追加のみ。
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
  model_name?: string;
  model_version?: string;
  pipeline_name?: string;
  pipeline_version?: string;
}
