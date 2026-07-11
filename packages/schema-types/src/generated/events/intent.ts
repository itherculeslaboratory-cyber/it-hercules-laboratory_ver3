// GENERATED FILE — do not edit by hand.
// source: schemas/events/intent.schema.json
// title: Intent ledger event (ihl.process.intent.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 設計意図の append-only 台帳イベント。Truth キー truth/ihl.process.intent.v1/<intent_id>.json（envelope.id === intent_id 規約）。同一 intent_id の二重 append は put-if-absent で 409、UPDATE/DELETE 不能＝追記のみ（V3-AIP-35/36）。commit_id/post_id は intent 後に確定するため nullable。
 */
export interface Intent {
  /**
   * 意図イベントの一意キー（ULID）。envelope.id と一致させる。
   */
  intent_id: string;
  /**
   * 対象仕様の版（最終要件定義書 version など）。
   */
  spec_version: string;
  /**
   * 意図の要約。
   */
  intent_summary: string;
  /**
   * 解決したい問題の記述。
   */
  problem_statement: string;
  /**
   * 期待する効果。
   */
  expected_effect: string;
  /**
   * 発生時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
  /**
   * 棄却した代替案（任意）。
   */
  rejected_alternatives?: string[];
  /**
   * 決定の出所（裁定記録 ID など・任意）。
   */
  decision_source?: string;
  /**
   * 紐づくコミット ID。commit は intent 後に打たれるため nullable。
   */
  commit_id?: string | null;
  /**
   * 知の広場の post_id。K6 BBS 依存のため nullable。
   */
  post_id?: string | null;
}
