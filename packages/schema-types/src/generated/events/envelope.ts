// GENERATED FILE — do not edit by hand.
// source: schemas/events/envelope.schema.json
// title: IHL Event Envelope (CloudEvents v1.0 + ULID + provenance)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * R2 Truth の append-only イベントの薄いエンベロープ。CloudEvents v1.0 準拠（specversion/id/source/type/time/dataschema）+ 独自 provenance 拡張（B2 §5 ルール 3・研究レポート research-ai-first-data-design-v1.md）。イベント型のバージョンは type に内包（ihl.<domain>.<event>.v<N>）。破壊的変更は type バージョンを上げた新イベントとして発行し、旧イベントは書き換えず投影層 upcaster で読む。data 部の形状は dataschema が指す schemas/frozen/*（該当時）または各ドメインスキーマが規定する。
 */
export interface Envelope {
  /**
   * CloudEvents 仕様バージョン。
   */
  specversion: "1.0";
  /**
   * ULID（26 文字 Crockford Base32・時系列ソート可）。source 内で一意。二重発行検知の冪等キー（開発計画 R-10）。
   */
  id: string;
  /**
   * イベント発生源のコンテキスト（例: 'apps/api'・collector_id・device_id）。CloudEvents source。
   */
  source: string;
  /**
   * イベント型（バージョン内包）。例: 'ihl.obs.image_captured.v1'。破壊的変更は v を上げる。
   */
  type: string;
  /**
   * イベント発生時刻（RFC3339 / ISO 8601）。
   */
  time: string;
  /**
   * data 部を検証するスキーマの URI（repo 内 schemas/ への参照。非互換変更は別 URI）。frozen 契約に対応する data は schemas/frozen/* を指す。
   */
  dataschema?: string;
  /**
   * 既定 'application/json'。省略時は JSON とみなす。
   */
  datacontenttype?: string;
  /**
   * source 内での対象（例: individual_id・capture_id）。任意。
   */
  subject?: string;
  /**
   * 独自拡張。イベントの生成主体と入力（B2 §5 ルール 3）。CL-02 の Truth 再現性メタ（frozen/provenance.schema.json）とは別層。
   */
  provenance: {
    /**
     * 生成主体の種別。
     */
    generator_kind: "human" | "agent" | "device";
    /**
     * generator_kind=agent のときの AI エージェント名（例: 'claude-code'）。
     */
    agent_name?: string;
    /**
     * generator_kind=agent のときのモデル ID。粒度（プロンプトハッシュ・コスト記録の要否）は B7 と併せて確定 — C1 実機照合で確定。
     */
    model_id?: string;
    /**
     * generator_kind=device のときのデバイス/collector ID。
     */
    device_id?: string;
    /**
     * generator_kind=human のときの actor_id（CL-03 導出）。
     */
    actor_id?: string;
    /**
     * このイベントを導いた入力イベントの ULID 列（投影・派生の系譜）。
     */
    input_event_ids?: string[];
  };
  /**
   * イベント本体。形状は dataschema が指すスキーマが規定。
   */
  data: {};
}
