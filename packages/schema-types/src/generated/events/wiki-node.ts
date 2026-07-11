// GENERATED FILE — do not edit by hand.
// source: schemas/events/wiki-node.schema.json
// title: Research wiki node (ihl.research.wiki_node.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 日次蒸留の Wiki ノード（WIK-01）。Truth キー truth/ihl.research.wiki_node.v1/<node_id>.json（node_id=決定論 sha1(level|scope_ref|content_hash)→同一入力で同一ノード append-only。envelope.id は別途 ulid()）。掲示板要約(board_summary) の上に大 Wiki(big_wiki) を積む階層。新聞は content_type=newspaper で content に格納（別スキーマ不要）。
 */
export interface WikiNode {
  /**
   * 決定論キー（storage key と一致・route が算出）。
   */
  node_id: string;
  /**
   * 階層（board_summary=掲示板要約 / big_wiki=大 Wiki）。
   */
  level: "board_summary" | "big_wiki";
  /**
   * 対象参照（掲示板ID／論文ID 等）。
   */
  scope_ref: string;
  /**
   * 蒸留された要約 Markdown。
   */
  summary_markdown: string;
  /**
   * 蒸留元イベント ID 群。
   */
  source_event_ids: string[];
  /**
   * 生成時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版（例: '1'）。
   */
  schema_version: string;
}
