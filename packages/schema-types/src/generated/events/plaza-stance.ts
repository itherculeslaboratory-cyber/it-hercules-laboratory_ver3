// GENERATED FILE — do not edit by hand.
// source: schemas/events/plaza-stance.schema.json
// title: Plaza stance data (ihl.plaza.stance.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * Polis 型の賛否表明イベント ihl.plaza.stance.v1 の data 部（BBS-36）。Truth キー truth/ihl.plaza.stance.v1/<statement_id>/<stance_id>.json に append-only。同 actor の再投票は projectConsensus が最新 ULID を latest として採用（上書きせず追記）。consensus/divisive は決定論算術で都度投影（LLM 不要）。
 */
export interface PlazaStance {
  /**
   * 表明の一意キー（ULID）。
   */
  stance_id: string;
  /**
   * 表明者の actor_id（セッション principal 強制・V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 対象ステートメント（=post_id 等）。
   */
  statement_id: string;
  /**
   * 賛否（Agree/Disagree/Pass・BBS-36）。
   */
  value: "agree" | "disagree" | "pass";
  /**
   * 表明時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
