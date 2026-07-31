// GENERATED FILE — do not edit by hand.
// source: schemas/events/fnd-sandbox-realm.schema.json
// title: Personal Sandbox Realm event (ihl.fnd.sandbox_realm.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * Personal Sandbox Realm の fork/promote/delete を記録する append-only イベント（V3-FND-31）。Truth キー truth/ihl.fnd.sandbox_realm.v1/<realm_id>-<ulid>.json。fork するのは本番 FeatureNode config（設定）であり任意コードではない。実際の設定差分(.sbx.json)は R2 オブジェクトであって Truth イベントではなく、本スキーマは fork/promote/delete の事実だけを持つ（design19 T1-9 案A）。同名の sandbox-routes.ts（V3-SEC-45 隔離実行の認可ゲート）とは中身が無関係の別要件であり、混同しない。
 */
export interface FndSandboxRealm {
  /**
   * Realm の一意キー（ULID）。
   */
  realm_id: string;
  /**
   * Realm 所有者の actor_id（5個/user上限・管理者無制限）。
   */
  user_id: string;
  /**
   * fork(本番からの分岐開始)/promoted(role=administratorのみ本番へ反映)/deleted。
   */
  action: "forked" | "promoted" | "deleted";
  /**
   * fork 元の本番 config バージョン（action=forked のとき付随・任意）。
   */
  forked_from_version?: string;
  /**
   * 発生時刻（RFC3339）。
   */
  at: string;
  /**
   * data スキーマ版（任意）。
   */
  schema_version?: string;
}
