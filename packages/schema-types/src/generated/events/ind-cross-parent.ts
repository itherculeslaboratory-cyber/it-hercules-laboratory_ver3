// GENERATED FILE — do not edit by hand.
// source: schemas/events/ind-cross-parent.schema.json
// title: Individual Cross Parent data (ihl.ind.cross_parent.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 血統（親子）append-only イベントの data 部。血統 Truth 正本（ADR-H-11: 血統は cross_parent.parent_role で持つ・individual master に sire/dam を固定枠として持たない）。Truth キー truth/ihl.ind.cross_parent.v1/<child_id>-<parent_role>.json。buildPedigree が再帰 walk して系譜ツリーを都度再計算（不変条項①）。
 */
export interface IndCrossParent {
  /**
   * 子個体の individual_id。
   */
  child_id: string;
  /**
   * 親個体の individual_id。欠損親（未登録親）は本イベント自体を持たず、投影で known:false ノードになる。
   */
  parent_id: string;
  /**
   * 親の役割（sire=父 / dam=母 / surrogate=里親）。
   */
  parent_role: "sire" | "dam" | "surrogate";
  /**
   * 記録者の actor_id（V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 記録時刻（RFC3339）。
   */
  created_at: string;
}
