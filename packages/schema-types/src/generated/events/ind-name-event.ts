// GENERATED FILE — do not edit by hand.
// source: schemas/events/ind-name-event.schema.json
// title: Individual Name Event data (ihl.ind.name_event.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 個体改名 append-only イベントの data 部。Truth キー truth/ihl.ind.name_event.v1/<individual_id>-<ulid>.json。projectName が created_at 昇順 reduce で最新名／at 指定で当時名を再現。brand_template active=false 後も過去の name_event は保持され再現可能（不変条項③）。
 */
export interface IndNameEvent {
  /**
   * 対象個体の individual_id。
   */
  individual_id: string;
  /**
   * この時点で付与された表示名。
   */
  name: string;
  /**
   * 命名に用いたブランドテンプレの brand_template_id（任意）。
   */
  brand_template_id?: string;
  /**
   * 改名者の actor_id（V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 昇格主体（V3-IND-05）。手動/半自動/自動の別。v1 は完全手動昇格のみのため実質 manual 固定運用だが、v2 の自動候補提示に備えスキーマは3値を許容する（任意）。
   */
  actor_type?: "manual" | "semi_auto" | "auto";
  /**
   * 昇格理由（V3-IND-05・任意）。血統(親子)表示で最良個体を次世代シリーズ名へ昇格させた根拠を記録する自由記述。
   */
  promotion_reason?: string;
  /**
   * 改名時刻（RFC3339）。当時名再現の時系列キー。
   */
  created_at: string;
}
