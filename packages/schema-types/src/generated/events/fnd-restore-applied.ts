// GENERATED FILE — do not edit by hand.
// source: schemas/events/fnd-restore-applied.schema.json
// title: Foundation restore-applied event (ihl.fnd.restore_applied.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 復元ポイント適用の append-only 監査イベント（V3-FND-08）。Truth キー truth/ihl.fnd.restore_applied.v1/<actor_id>-<ulid>.json。★append-only の Truth では『巻き戻し』ができないため、復元は『過去内容を新しいULIDで現在時刻の新イベントとして再投稿する』操作として実装する（design19 T1-4 案A・design35からの訂正）。本イベントは復元操作そのものの事実（いつ・どの復元ポイントを・何件適用したか）だけを記録し、再投稿された各イベント自体は別途通常のイベントとして append される。
 */
export interface FndRestoreApplied {
  /**
   * 復元を実行した actor_id（セッション principal 強制・V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 適用した復元ポイントの一意キー。
   */
  restore_point_id: string;
  /**
   * 再投稿されたイベント件数。
   */
  applied_event_count: number;
  /**
   * 復元適用時刻（RFC3339）。
   */
  at: string;
  /**
   * data スキーマ版（任意）。
   */
  schema_version?: string;
}
