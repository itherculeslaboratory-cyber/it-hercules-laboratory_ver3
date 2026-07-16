// GENERATED FILE — do not edit by hand.
// source: schemas/events/gov-vote.schema.json
// title: Governance vote data (ihl.gov.vote.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * ガバナンス投票イベント ihl.gov.vote.v1 の data 部（GOV-19/23）。Truth キー truth/ihl.gov.vote.v1/<proposal_target>/<vote_id>.json に append-only。projectThreshold（threshold_adjust）・projectForkRanks（fork_rank）・projectOsPromotion（os_merge）が approve 多数決を都度投影。ルールも fork 対象。
 */
export interface GovVote {
  /**
   * 投票の一意キー（ULID）。
   */
  vote_id: string;
  /**
   * 投票者の actor_id（セッション principal 強制・V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 投票種別（OS 昇格 / 閾値調整 / fork ランク昇降 / V3-GOV-35 誤BAN復帰判定）。misban_reversal は proposal_target=停止された出品者 actor_id・value=approve が「誤BAN」票。
   */
  kind: "os_merge" | "threshold_adjust" | "fork_rank" | "misban_reversal";
  /**
   * 提案対象（rule_id / fork_id / os ref）。
   */
  proposal_target: string;
  /**
   * 賛否。
   */
  value: "approve" | "reject";
  /**
   * threshold_adjust 時の提案閾値（任意）。
   */
  adjust_to?: number;
  /**
   * fork_rank 時の提案ランク（任意・FORK_RANKS のいずれか）。
   */
  rank_to?: string;
  /**
   * 投票時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
