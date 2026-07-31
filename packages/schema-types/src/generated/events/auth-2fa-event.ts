// GENERATED FILE — do not edit by hand.
// source: schemas/events/auth-2fa-event.schema.json
// title: Auth 2FA state event (ihl.auth.2fa.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * TOTP/2FA の有効化・解除の事実イベント（append-only・V3-AUT-32）。Truth キー truth/ihl.auth.2fa.v1/<actor_id>-<ulid>.json。★TOTP seed は本スキーマに一切含まない（seed は削除可能な KV へ置き、Truth には『いつ有効化・解除したか』という監査事実だけを残す設計・design19 T1-2 案A）。
 */
export interface Auth2FaEvent {
  /**
   * 対象 actor_id（セッション principal 強制・V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 2FA の有効化/解除。
   */
  action: "enabled" | "disabled";
  /**
   * 発生時刻（RFC3339）。
   */
  at: string;
  /**
   * data スキーマ版（任意）。
   */
  schema_version?: string;
}
