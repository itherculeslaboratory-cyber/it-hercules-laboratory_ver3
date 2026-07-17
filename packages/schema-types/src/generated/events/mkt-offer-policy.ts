// GENERATED FILE — do not edit by hand.
// source: schemas/events/mkt-offer-policy.schema.json
// title: Individual direct-offer policy (ihl.mkt.offer_policy.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 未出品個体への直接オファーの受入方針(V3-MKT-06)。append-only・last-write-wins(pref-set.schema.jsonと同じ規約)。Truth キー truth/ihl.mkt.offer_policy.v1/<individual_id>/<policy_id>.json。設定できるのはその個体の現観測者(=個体マスタの actor_id)のみ(route ガード)。未設定時の既定は route 側の基本テンプレ 'open'(GOV-35のプリセットと同型)。
 */
export interface MktOfferPolicy {
  /**
   * 設定イベントの一意キー(ULID)。
   */
  policy_id: string;
  /**
   * 対象個体の individual_id。
   */
  individual_id: string;
  /**
   * 設定者の actor_id(セッション principal 強制・現観測者=個体マスタの actor_id と route が一致確認する)。
   */
  actor_id: string;
  /**
   * open=誰でもオファー可(既定) / closed=完全拒否 / research_only=研究目的申告のオファーのみ受理。
   */
  policy: "open" | "closed" | "research_only";
  /**
   * 任意の一言(個別override理由等)。
   */
  note?: string;
  /**
   * 設定時刻(RFC3339)。last-write-wins の並び替えキー。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
