// GENERATED FILE — do not edit by hand.
// source: schemas/frozen/individual-key.schema.json
// title: Individual Key (CL-06)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 既存観測データの個体キー。命名・粒度を変えると既存個体・血統が参照不能になる（要件定義書 CL-06 / V3-IND-01 / FR-MVP-04）。individual_id は ver2 individual.schema.yaml の Truth キーそのもの。sire_id/dam_id については ver2 内で記述が割れているため下記 description を厳守（発明しない）。
 */
export interface IndividualKey {
  /**
   * 個体の一意キー。既存観測・血統の参照先。
   */
  individual_id: string;
  local_label_text?: string;
  species?: string;
  birth_or_hatch_date?: string;
  source_type?: string;
  raw_source_ref?: string;
  note?: string;
  observation_target_domain?: string;
  record_version?: number;
  /**
   * 父親個体 ID（任意）。ver2 では矛盾が記録されている: (a) FR-MVP-04 は観測セッション JSON に individual_id / sire_id(任意) / dam_id(任意) を載せる、(b) しかし ADR-H-11 で Cross から sire_id/dam_id は削除確定・血統 Truth 正本は cross_parent.parent_role(sire/dam/surrogate…)、(c) individual_master/searchable_capture_set の sire_id/dam_id は Snapshot 派生列(derived_*)で Truth ではない（設計網羅監査 A §3.3・schema-yaml-draft-v1.md N-1）。よって本フィールドは Truth コア固定枠ではなく FR-MVP-04 セッション任意ポインタ/投影派生の位置づけ。ver3 での正式な住所（セッション層 or 投影層 or 廃止）は C1 実機照合で確定。
   */
  sire_id?: string;
  /**
   * 母親個体 ID（任意）。sire_id と同じ扱い（上記 description 参照）。血統 Truth 正本は cross_parent。C1 実機照合で確定。
   */
  dam_id?: string;
  schema_version: number;
  run_id: string;
  created_at: string;
}
