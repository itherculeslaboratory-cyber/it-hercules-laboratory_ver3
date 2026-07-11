// GENERATED FILE — do not edit by hand.
// source: schemas/events/culture-template.schema.json
// title: Culture template version event (ihl.culture.template.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 文化テンプレの版イベント（append-only）。Truth キー truth/ihl.culture.template.v1/<version_id>.json（envelope.id === version_id 規約）。fork=forked_from、diff/restore は版イベント列の投影で導出（V3-AIP-76）。kind=eval_axis の body は evaluation-axis.schema.json 構造に一致させる。
 */
export interface CultureTemplate {
  /**
   * テンプレ系列の識別子（版をまたいで安定）。
   */
  template_id: string;
  /**
   * 版イベントの一意キー（ULID）。envelope.id と一致させる。
   */
  version_id: string;
  /**
   * テンプレ種別。eval_axis の body は evaluation-axis 構造。
   */
  kind: "ui_theme" | "board_structure" | "eval_axis";
  /**
   * テンプレ本体。kind 別の構造（eval_axis は evaluation-axis.schema.json 契約）。
   */
  body: {};
  /**
   * 版を打った actor_id。
   */
  author_actor_id: string;
  /**
   * 発生時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
  /**
   * 親版の version_id（fork 元・任意 nullable）。
   */
  forked_from?: string | null;
  /**
   * 版に付す注記（任意）。
   */
  note?: string;
}
