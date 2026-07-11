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
   * 改名時刻（RFC3339）。当時名再現の時系列キー。
   */
  created_at: string;
}
