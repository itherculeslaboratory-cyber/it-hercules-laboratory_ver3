// GENERATED FILE — do not edit by hand.
// source: schemas/events/plaza-resolution.schema.json
// title: Plaza thread resolution data (ihl.plaza.resolution.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * スレの解決マーク（[✔解決した]/[取り消す]）イベント ihl.plaza.resolution.v1 の data 部（BBS-05・OQ-PLZ-03）。Truth キー truth/ihl.plaza.resolution.v1/<thread_id>/<resolution_id>.json に append-only。取消は新イベント（action=unresolve）を追記する supersede パターンで表現し、元イベントは UPDATE/DELETE しない。権限はスレ主のみ（root post の actor_id と一致・route 側で強制）。
 */
export interface PlazaResolution {
  /**
   * 解決マークの一意キー（ULID）。
   */
  resolution_id: string;
  /**
   * マーク実行者の actor_id（スレ主のみ・route 側で強制・V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 対象スレッドキー。
   */
  thread_id: string;
  /**
   * 解決/取消（取消は新イベントの追記・BBS-05・元イベントは不変）。
   */
  action: "resolve" | "unresolve";
  /**
   * 結論候補ゼロで解決した際の任意の結び1行（F3・未入力可）。
   */
  note?: string;
  /**
   * マーク時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
