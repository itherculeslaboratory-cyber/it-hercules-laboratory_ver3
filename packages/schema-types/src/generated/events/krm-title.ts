// GENERATED FILE — do not edit by hand.
// source: schemas/events/krm-title.schema.json
// title: KRM title grant event (ihl.krm.title.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 称号付与の append-only イベント（V3-KRM-17）。Truth キー truth/ihl.krm.title.v1/<actor_id>-<ulid>.json。称号は『自称×他称×貢献』の軸(axis)で構成され、行動条件/貢献パターンに応じ自動(auto)または投票(vote)で付与される。ユーザーの表示/非表示/削除選択は本イベントの上に別イベントとして重ねる想定であり、本スキーマは付与そのものの事実だけを持つ。
 */
export interface KrmTitle {
  /**
   * 称号の一意キー（ULID）。
   */
  title_id: string;
  /**
   * 称号を付与された actor_id。
   */
  actor_id: string;
  /**
   * 自動付与(行動条件/貢献パターン)か投票付与か。
   */
  granted_by: "auto" | "vote";
  /**
   * 称号の軸（自称/他称/貢献のいずれか、または軸名の識別子）。
   */
  axis: string;
  /**
   * 付与時刻（RFC3339）。
   */
  granted_at: string;
  /**
   * data スキーマ版（任意）。
   */
  schema_version?: string;
}
