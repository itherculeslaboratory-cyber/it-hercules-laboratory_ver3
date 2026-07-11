// GENERATED FILE — do not edit by hand.
// source: schemas/events/mapping-event.schema.json
// title: Canonical mapping event (ihl.research.mapping_event.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * Wikidata Q番号 ↔ 分野別専門 DB の対応 append-only 記録（PPR-13）。Truth キー truth/ihl.research.mapping_event.v1/<qid>__<target_db>.json（Q番号+対象DB 合成キー→同一対応の再 put=409・put-if-absent。envelope.id は別途 ulid()）。target_db は research-constants DOMAIN_API_MAP の値。
 */
export interface MappingEvent {
  /**
   * 対応の一意キー（storage key と一致・route が算出）。
   */
  mapping_id: string;
  /**
   * Wikidata Q番号（例: 'Q12345'）。
   */
  wikidata_qid: string;
  /**
   * 対応先 DB（DOMAIN_API_MAP の値・例: 'GBIF'）。
   */
  target_db: string;
  /**
   * 対応先 DB での ID。
   */
  target_id: string;
  /**
   * 分野（DOMAIN_API_MAP のキー・例: 'biology'）。
   */
  domain: string;
  /**
   * 発生時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版（例: '1'）。
   */
  schema_version: string;
}
