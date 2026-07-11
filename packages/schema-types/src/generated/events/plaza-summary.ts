// GENERATED FILE — do not edit by hand.
// source: schemas/events/plaza-summary.schema.json
// title: Plaza summary data (ihl.plaza.summary.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * スレッド要約イベント ihl.plaza.summary.v1 の data 部（BBS-10・4層要約の第3/4層）。Truth キー truth/ihl.plaza.summary.v1/<thread_id>/<block_index>-<summary_id>.json に append-only。block_index=floor(post 通番/SUMMARY_BLOCK_SIZE)。要約本文は空スロット許容＝手動/後日バッチが append（LLM 呼び出しはコードに入れない・既定 OFF）。
 */
export interface PlazaSummary {
  /**
   * 要約イベントの一意キー（ULID）。
   */
  summary_id: string;
  /**
   * 対象スレッドキー。
   */
  thread_id: string;
  /**
   * ブロック番号（floor(post 通番/SUMMARY_BLOCK_SIZE)・100 投稿ごと）。
   */
  block_index: number;
  /**
   * 現在の要約本文（空文字許容＝空スロット・手動/バッチが後日埋める）。
   */
  current_summary: string;
  /**
   * 未解決の論点（任意）。
   */
  open_questions?: string[];
  /**
   * 前 summary からの差分（任意・diff 履歴として projectSummary が積む）。
   */
  diff?: string;
  /**
   * 生成主体（manual=人手 / batch=後日バッチ・LLM 直呼びはしない）。
   */
  generator: "manual" | "batch";
  /**
   * 要約時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
