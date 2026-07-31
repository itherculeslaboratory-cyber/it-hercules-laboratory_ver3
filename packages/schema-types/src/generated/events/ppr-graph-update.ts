// GENERATED FILE — do not edit by hand.
// source: schemas/events/ppr-graph-update.schema.json
// title: Living Paper graph update history (ihl.research.graph_update.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * Living Paper(V3-PPR-14)のグラフ自動更新履歴 append-only イベント。Truth キー truth/ihl.research.graph_update.v1/<content_id>/<update_id>.json。POST /research/graph/update(paper-match-routes.ts)が返す非永続プレビュー(computeLivingPaperGraph の出力)を、呼び手が確認のうえ本イベントとして追記すると更新履歴になる(content.schema.json 本体は書き換えない・履歴は別イベントストリームとして積む=INSERT ONLY・不変条項③)。graph_snapshot はサーバ算出値のスナップショット(ユーザー直接入力ではない)であり、computeLivingPaperGraph() の出力構造に追随するため厳密な additionalProperties:false 制約は課さない。
 */
export interface PprGraphUpdate {
  /**
   * この更新履歴行の一意キー（ULID）。
   */
  update_id: string;
  /**
   * 対象 Living Paper の content_id（schemas/events/content.schema.json 側の正本を参照）。
   */
  content_id: string;
  /**
   * 更新を確定させた actor_id（セッション principal 強制・V3-AUT-17）。
   */
  actor_id: string;
  /**
   * この更新の引き金になった観測/イベントの参照（任意・capture_id 等）。
   */
  triggered_by?: string;
  /**
   * 更新時点の信頼度（computeLivingPaperGraph().confidence・任意）。
   */
  confidence?: number;
  /**
   * この更新に使われた観測件数（任意）。
   */
  observation_count?: number;
  /**
   * computeLivingPaperGraph() の出力全体（conditions/sections/match/claims/quadrant 等）のスナップショット（任意）。サーバ算出値のキャッシュであり additionalProperties は制限しない。
   */
  graph_snapshot?: {
    [k: string]: unknown;
  };
  /**
   * 更新確定時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
