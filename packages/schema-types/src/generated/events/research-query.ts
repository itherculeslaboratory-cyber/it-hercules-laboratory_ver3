// GENERATED FILE — do not edit by hand.
// source: schemas/events/research-query.schema.json
// title: Research Query condition data (ihl.research.query.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * F2研究者モードの検索条件JSON保存の append-only イベントの data 部。Truth キー truth/ihl.research.query.v1/<query_id>.json。生成器(apps/web/src/research/query-generator.ts)が受け取る ResearchQueryJson(select/conditions/limit)をそのまま query に格納し、manifest_generation で再現性100%を担保する(同じ generation + 同じ query = 同じ結果)。クライアント側のダウンロード/URL共有(condition-share.ts)は本イベントの追加で置き換えない — 併存する(g81-f2wiring T4・R0801-73be3e §7-1の申し送り)。
 */
export interface ResearchQuery {
  /**
   * 保存イベントの一意キー(保存のたびに新規)。
   */
  query_id: string;
  /**
   * 保存した利用者の actor_id(V3-AUT-17)。
   */
  actor_id: string;
  /**
   * この条件JSONが対象とした manifest の generation番号(condition-share.ts の SavedResearchCondition.manifest_generation と同じ役割)。
   */
  manifest_generation: number;
  /**
   * 生成器(query-generator.ts)が受け取る ResearchQueryJson 本体(select/conditions/limit)。ホワイトリスト検証は保存時ではなく実行時(生成器側)で行うため、ここでは形の自由度を残す。
   */
  query: {
    [k: string]: unknown;
  };
  /**
   * 保存した条件に付ける任意のラベル(検索条件を保存(JSONダウンロード)と同様、必須ではない)。
   */
  label?: string;
  /**
   * 保存時刻(RFC3339・任意)。
   */
  created_at?: string;
}
