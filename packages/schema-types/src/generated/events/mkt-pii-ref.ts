// GENERATED FILE — do not edit by hand.
// source: schemas/events/mkt-pii-ref.schema.json
// title: Market PII reference event (ihl.mkt.pii_ref.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 取引PIIの参照(reference)の append-only イベント（V3-MKT-28）。Truth キー truth/ihl.mkt.pii_ref.v1/<trade_id>-<ulid>.json。★PIIの実体（氏名・配送先・振込口座・局留め設定）を一切含まない。実体は削除可能なストア（KV/非truthプレフィクス）に本人プロフィールとして持ち、本イベントは『誰が誰に何を見せているか』の参照権限のみを記録する。action=revoked を append することで『取引完了後の消去』を参照失効として表現する（design19 T1-3 案A）。
 */
export interface MktPiiRef {
  /**
   * 対象取引の一意キー。
   */
  trade_id: string;
  /**
   * PIIの所有者（本人）の actor_id。
   */
  owner_actor_id: string;
  /**
   * PIIスロット名（例: 氏名/配送先/振込口座/局留め設定。値そのものは含まない）。
   */
  slot: string;
  /**
   * 参照を許可された取引相手の actor_id。
   */
  granted_to: string;
  /**
   * 参照権限の付与/失効。revoked が『取引完了後の消去』に相当する。
   */
  action: "granted" | "revoked";
  /**
   * 発生時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版（任意）。
   */
  schema_version?: string;
}
