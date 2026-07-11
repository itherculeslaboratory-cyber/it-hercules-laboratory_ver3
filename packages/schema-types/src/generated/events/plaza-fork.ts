// GENERATED FILE — do not edit by hand.
// source: schemas/events/plaza-fork.schema.json
// title: Plaza fork data (ihl.plaza.fork.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * フォーク公開イベント ihl.plaza.fork.v1 の data 部（BBS-29/GOV-19/23）。Truth キー truth/ihl.plaza.fork.v1/<target_type>/<fork_id>.json に append-only。全 fork は非削除で共存。effective rank は projectForkRanks が gov.vote(kind=fork_rank) の最新 approve を畳んで都度投影（初期=public→beginner / private→非掲載）。content_hash で改変検知（GOV-23）。
 */
export interface PlazaFork {
  /**
   * フォークの一意キー（ULID）。
   */
  fork_id: string;
  /**
   * フォーク作成者の actor_id（セッション principal 強制・V3-AUT-17）。
   */
  actor_id: string;
  /**
   * フォーク対象の種別（GOV-23 の os/screen/component ほか）。
   */
  target_type: "component" | "screen" | "rule" | "os" | "template";
  /**
   * 親 ref 文字列（lineage・fork ツリーの親）。
   */
  forked_from: string;
  /**
   * 公開範囲（public→rank=beginner 掲載 / private→非掲載・BBS-29）。
   */
  visibility: "public" | "private";
  /**
   * フォークのタイトル。
   */
  title: string;
  /**
   * 内容の sha256 hex（改変検知・GOV-23・任意）。
   */
  content_hash?: string;
  /**
   * フォーク時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
