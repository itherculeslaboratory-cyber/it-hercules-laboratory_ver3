// GENERATED FILE — do not edit by hand.
// source: schemas/events/social-eval.schema.json
// title: Social evaluation event (ihl.social.eval.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * コンポーネント/ノードへの社会的評価（vote/like/dislike/favorite/follow/fork/proposal）の append-only イベント。Truth キー truth/ihl.social.eval.v1/<eval_id>.json。projectSocialEval が layer0-3 のみ集計（layer4 除外・本人自己評価除外）。公式ランキングは生成しない（統計のみ・V3-KRM-20）。
 */
export interface SocialEval {
  /**
   * 評価イベントの一意キー。
   */
  eval_id: string;
  /**
   * 評価対象ノードの ID。
   */
  target_node_id: string;
  /**
   * 対象レイヤー（0-3 のみ集計・layer4 除外）。
   */
  target_layer: number;
  /**
   * 評価者の actor_id（V3-AUT-17・自己評価は投影で除外）。
   */
  rater_id: string;
  /**
   * 評価種別。
   */
  kind: "vote" | "like" | "dislike" | "favorite" | "follow" | "fork" | "proposal";
  /**
   * 発生時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
