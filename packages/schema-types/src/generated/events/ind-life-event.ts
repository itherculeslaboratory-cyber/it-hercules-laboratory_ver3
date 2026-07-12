// GENERATED FILE — do not edit by hand.
// source: schemas/events/ind-life-event.schema.json
// title: Individual Life Event data (ihl.ind.life_event.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 個体ライフイベント append-only の data 部（誕生／脱皮／死亡／羽化／標本化／移動）。Truth キー truth/ihl.ind.life_event.v1/<individual_id>-<ulid>.json。projectIndividual が at 昇順に timeline へ集約し、projectCross が死亡率等の率系を決定論算出（不変条項①）。
 */
export interface IndLifeEvent {
  /**
   * 対象個体の individual_id。
   */
  individual_id: string;
  /**
   * ライフイベント種別（誕生／脱皮／死亡／羽化／標本化／移動／生存訂正）。survival_correction は誤った死亡記録の訂正（V3-AIP-101 個体詳細スライスA・append-only — 元の death レコードは消さず、より新しい survival_correction が status 導出で優先される）。
   */
  kind: "birth" | "molt" | "death" | "eclosion" | "specimen" | "move" | "survival_correction";
  /**
   * イベント発生時刻（RFC3339）。timeline の時系列キー。
   */
  at: string;
  /**
   * 種別依存の付随情報（任意）。移動先・令齢・標本種別など。
   */
  detail?: {
    [k: string]: unknown;
  };
  /**
   * 記録者の actor_id（V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 記録時刻（RFC3339・任意）。
   */
  created_at?: string;
}
