// GENERATED FILE — do not edit by hand.
// source: schemas/events/obs-template.schema.json
// title: Observation Template data (ihl.obs.template.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 観測テンプレイベント ihl.obs.template.v1 の data 部。Truth キー truth/ihl.obs.template.v1/<template_id>.json。fork（forked_from）で系譜継承（V3-OBS-18・フォーク文化 不変条項②）。
 */
export interface ObsTemplate {
  /**
   * テンプレの一意キー（<template_ulid>）。
   */
  template_id: string;
  /**
   * 作成者の actor_id。
   */
  actor_id: string;
  /**
   * テンプレ表示名。
   */
  title: string;
  /**
   * 計測項目定義の配列。
   */
  items: {
    /**
     * 項目ラベル。
     */
    label: string;
    /**
     * 入力種別。
     */
    kind: "number" | "text" | "select" | "image-annotation" | "api" | "calc";
    /**
     * kind=select の選択肢（任意）。
     */
    options?: string[];
    /**
     * 単位（任意）。
     */
    unit?: string;
    /**
     * 項目ハッシュ（辞書登録キー・未登録検出用・任意 ADDITIVE V3-OBS-18）。
     */
    item_hash?: string;
  }[];
  /**
   * テンプレ適用範囲（雌雄別／令齢別／置き場所別・任意 ADDITIVE V3-OBS-18）。
   */
  scope?: {
    /**
     * 雌雄（任意）。
     */
    sex?: string;
    /**
     * 令齢（初／二／三令初期／三令後期・任意）。
     */
    instar?: "first" | "second" | "third_early" | "third_late";
    /**
     * 置き場所（任意）。
     */
    placement?: string;
  };
  /**
   * fork 元テンプレの template_id（V3-OBS-18・任意）。
   */
  forked_from?: string;
}
