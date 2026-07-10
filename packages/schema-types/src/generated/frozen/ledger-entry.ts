// GENERATED FILE — do not edit by hand.
// source: schemas/frozen/ledger-entry.schema.json
// title: Ledger Entry — Karma / Platinum Coin (CL-12)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 既存の全ミューテーションが R2 INSERT ONLY で記録済み。台帳形式変更で残高/信用の再計算が狂う（要件定義書 CL-12 / V3-KRM-19）。カルマ台帳（karma_event・増減）とプラチナ功績章台帳（coin_event・付与のみ）の 2 変種を oneOf で表す（ver2 schemas/economy/karma_event.schema.yaml・coin_event.schema.yaml）。PT 影響力台帳（pt_event）も同一の append-only パターンだが CL-12 の対象は『カルマ/プラチナ』のため本スキーマは 2 変種に限定。
 */
export type LedgerEntry = KarmaEvent | CoinEventPlatinum;

/**
 * カルマ台帳エントリ。value 層 / count 層の 2 層、delta は増減可。
 */
export interface KarmaEvent {
  karma_event_id: string;
  actor_id: string;
  layer: "value" | "count";
  delta: number;
  reason_code?: "monthly_batch" | "dispute" | "fee_unpaid" | "manual" | "other";
  dispute_event_ref?: string;
  created_at: string;
  schema_version: number;
}
/**
 * プラチナ功績章台帳エントリ。grant_amount は付与のみ（>= 0）。
 */
export interface CoinEventPlatinum {
  coin_event_id: string;
  actor_id: string;
  grant_amount: number;
  reason_code?: "vote_reward" | "contribution_rebate" | "manual" | "other";
  vote_event_ref?: string;
  created_at: string;
  schema_version: number;
}
