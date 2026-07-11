// GENERATED FILE — do not edit by hand.
// source: schemas/events/economy-contribution-event.schema.json
// title: Contribution axis event (ihl.economy.contribution_event.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 3 軸貢献度（research/capital/development）の append-only 加算イベント。Truth キー truth/ihl.economy.contribution_event.v1/<contribution_event_id>.json。projectContribution が軸別に非負累積（減算不可＝invariant・V3-KRM-10/12）。累計残高は非減衰。
 */
export interface EconomyContributionEvent {
  /**
   * 貢献イベントの一意キー。
   */
  contribution_event_id: string;
  /**
   * 貢献先ノード（コンポーネント／論文等）の ID。祖先へ重み配分する起点。
   */
  node_id: string;
  /**
   * 貢献者の actor_id（V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 貢献の軸（研究 / 資本 / 開発）。
   */
  axis: "research" | "capital" | "development";
  /**
   * 加算量（非負のみ＝累積 invariant。減算イベントは append 側 guard で拒否）。
   */
  delta: number;
  /**
   * 貢献の出所（github / board / fork / vote / tax / manual）。
   */
  source: "github" | "board" | "fork" | "vote" | "tax" | "manual";
  /**
   * 出所イベント／対象の参照（任意）。
   */
  source_ref?: string;
  /**
   * 発生時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
