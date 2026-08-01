// GENERATED FILE — do not edit by hand.
// source: schemas/events/content-current.schema.json
// title: Research content current-generation pointer (ihl.research.content_current.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 「いつでも戻せる」復元ポインタ（V3-AIP-108/109・設計R0801-436936 §4案4-A・review-queue R0801-436936-refrestore REF-1=○）。Truth キー truth/ihl.research.content_current.v1/<lineage_root>/<pointer_id>.json に append-only。「戻す」＝旧世代を指すポインタを1件appendするだけで、既存イベントは1バイトも書き換えず generation も増やさない。現在値＝同一 lineage_root 配下の pointer_id（ULID）昇順の最後。plaza-resolution.schema.json（取消は新イベント追記のsupersedeパターン）と同型のイディオムを流用。
 */
export interface ContentCurrent {
  /**
   * このポインタ行の一意キー（ULID）。同一 lineage_root 配下でこの昇順の最後が現在値。
   */
  pointer_id: string;
  /**
   * この系譜の root 世代（generation:0）の content_id。GET .../generations と同じ up-walk でサーバが解決した値のみを埋める（クライアント指定は信用しない）。
   */
  lineage_root: string;
  /**
   * 現行として指す世代の content_id（戻し先）。
   */
  current_content_id: string;
  /**
   * 復元実行者の actor_id（セッション principal 強制・V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 復元時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
