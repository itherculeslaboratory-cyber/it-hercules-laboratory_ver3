// GENERATED FILE — do not edit by hand.
// source: schemas/events/plaza-fork.schema.json
// title: Plaza fork data (ihl.plaza.fork.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * フォーク公開イベント ihl.plaza.fork.v1 の data 部（BBS-29/GOV-19/23）。Truth キー truth/ihl.plaza.fork.v1/<target_type>/<fork_id>.json に append-only。全 fork は非削除で共存。effective rank は projectForkRanks が gov.vote(kind=fork_rank) の最新 approve を畳んで都度投影（初期=public→beginner / private→非掲載）。content_hash で改変検知（GOV-23）。target_type=docker_extension/world_template は V3-MKT-47(Docker観測拡張のフォーク管理・外部世界テンプレートのマーケット探索)がこの汎用フォーク基盤をそのまま再利用する(lineage記録のみ・実行基盤=デモ起動はV3-SEC-45裁定待ちで対象外)。
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
   * フォーク対象の種別（GOV-23 の os/screen/component ほか。docker_extension=V3-MKT-47 Docker観測拡張、world_template=同要件の外部世界テンプレート）。
   */
  target_type: "component" | "screen" | "rule" | "os" | "template" | "docker_extension" | "world_template";
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
   * SHA-256((親 fork の lineage_hash ?? GENESIS) + content_hash) の hex（任意・common/lineage-meta.schema.json と同じ連鎖ハッシュ規約。V3-MKT-47: docker_extension の改ざん検知チェーン）。
   */
  lineage_hash?: string;
  /**
   * フォーク時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
