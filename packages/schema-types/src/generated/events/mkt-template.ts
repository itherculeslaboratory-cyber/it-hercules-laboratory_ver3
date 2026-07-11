// GENERATED FILE — do not edit by hand.
// source: schemas/events/mkt-template.schema.json
// title: Template market listing event (ihl.mkt.template.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * テンプレ（論文/UIスキン/グラフ/重み/AIパック/プロンプト）出品・フォークの append-only イベント。Truth キー truth/ihl.mkt.template.v1/<template_id>.json。ranking は RANKING_WEIGHTS で投影算出、forked_from で系譜連結（V3-MKT-22）。
 */
export interface MktTemplate {
  /**
   * テンプレの一意キー。
   */
  template_id: string;
  /**
   * 出品者の actor_id（V3-AUT-17）。
   */
  actor_id: string;
  /**
   * テンプレ種別。
   */
  kind: "paper" | "ui_skin" | "graph" | "weights" | "ai_pack" | "prompt";
  /**
   * 表示タイトル。
   */
  title: string;
  /**
   * フォーク元テンプレ ID（任意・系譜連結）。
   */
  forked_from?: string;
  /**
   * 本体データの参照（blob key 等・任意）。
   */
  body_ref?: string;
  /**
   * 発生時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
