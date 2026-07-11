// GENERATED FILE — do not edit by hand.
// source: schemas/events/research-proposal.schema.json
// title: Research proposal event (ihl.research.proposal.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 改善案/仮説の append-only 状態機械イベント。Truth キー truth/ihl.research.proposal.v1/<proposal_event_id>.json。reduceProposal が rank 遷移（minor→beginner→popular→recommended→official）と hypothesis 状態機械（draft→hypothesis→supported/rejected）を投影、trust=支持/(支持+否定)。fork は rank=beginner 自動（V3-KRM-24）。
 */
export interface ResearchProposal {
  /**
   * 提案イベントの一意キー。
   */
  proposal_event_id: string;
  /**
   * 提案の集約 ID（状態機械のキー）。
   */
  proposal_id: string;
  /**
   * 発行者の actor_id（V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 提案アクション種別。
   */
  kind: "create" | "fork" | "rank_change" | "hypothesis_transition" | "support" | "reject";
  /**
   * ランク（rank_change 時・任意。fork は beginner 自動）。
   */
  rank?: "official" | "recommended" | "popular" | "beginner" | "minor";
  /**
   * 仮説状態（hypothesis_transition 時・任意）。
   */
  state?: "draft" | "hypothesis" | "supported" | "rejected";
  /**
   * フォーク元提案 ID（fork 時・任意）。
   */
  forked_from?: string;
  /**
   * 発生時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
