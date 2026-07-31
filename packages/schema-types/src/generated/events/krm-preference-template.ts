// GENERATED FILE — do not edit by hand.
// source: schemas/events/krm-preference-template.schema.json
// title: KRM preference template version event (ihl.krm.preference_template.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 価値観テンプレートの版イベント（append-only・V3-KRM-22③）。Truth キー truth/ihl.krm.preference_template.v1/<version_id>.json（envelope.id === version_id 規約・culture-template.schema.json と同じ fork 作法）。タグ項目ごとの『合わない/どちらとも/合う』(-1/0/+1) を items[] に持ち、forked_from で fork 元を記録、order で項目の並び替えを表現する（項目追加削除は新しい version として append）。書き込み経路は既存 POST /events を再利用し、新規 route は作らない（culture-template と同型）。
 */
export interface KrmPreferenceTemplate {
  /**
   * テンプレ系列の識別子（版をまたいで安定）。
   */
  template_id: string;
  /**
   * 版イベントの一意キー（ULID）。envelope.id と一致させる。
   */
  version_id: string;
  /**
   * 版を打った actor_id。
   */
  author_actor_id: string;
  /**
   * タグ項目ごとの3択評価。
   */
  items: {
    /**
     * 評価対象のタグ項目名。
     */
    tag: string;
    /**
     * 合わない(-1)/どちらとも(0)/合う(+1)。
     */
    value: -1 | 0 | 1;
  }[];
  /**
   * タグ項目の表示順（tag 名の配列・任意）。
   */
  order?: string[];
  /**
   * 親版の version_id（fork 元・任意 nullable）。
   */
  forked_from?: string | null;
  /**
   * 発生時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
