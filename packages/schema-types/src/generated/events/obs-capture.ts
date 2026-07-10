// GENERATED FILE — do not edit by hand.
// source: schemas/events/obs-capture.schema.json
// title: Observation Capture data (ihl.obs.capture.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 観測セッションイベント ihl.obs.capture.v1 の data 部。envelope に載る（Truth キー truth/ihl.obs.capture.v1/<capture_id>.json）。5 ドメイン分岐（V3-OBS-01）・種はユーザー確定のみ（V3-OBS-03）・親個体は FR-MVP-04 セッション任意ポインタ（frozen individual-key と同じ扱い）。
 */
export interface ObsCapture {
  /**
   * 観測セッションの一意キー（<capture_ulid>）。
   */
  capture_id: string;
  /**
   * 記録者の actor_id（CL-03 導出・本人スコープ V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 観測対象ドメイン（V3-OBS-01 の 5 分岐）。
   */
  domain: "biology" | "mineral" | "digital" | "place" | "custom";
  /**
   * 観測対象個体の参照（'individual/<individual_id>' 形式・V3-IND-01）。任意。
   */
  subject_ref?: string;
  /**
   * 父親個体 ID（任意）。FR-MVP-04 セッション任意ポインタ（frozen individual-key.sire_id と同じ位置づけ・Truth コア固定枠ではない）。
   */
  sire_id?: string;
  /**
   * 母親個体 ID（任意）。sire_id と同じ扱い。
   */
  dam_id?: string;
  /**
   * 種の候補。ユーザー入力のみ（AI 候補は入れない・V3-OBS-03）。任意。
   */
  species_candidate?: string;
  /**
   * 種の確定者。常に user（AI 確定は不可・V3-OBS-03）。任意（species_candidate 記入時に付随）。
   */
  species_confirmed_by?: "user";
  /**
   * 計測項目の配列。
   */
  measurements?: {
    /**
     * 計測項目名。
     */
    item: string;
    /**
     * 計測種別（number/text/select 等・テンプレ item.kind に対応）。
     */
    kind: string;
    /**
     * 計測値。
     */
    value: string | number;
    /**
     * 単位（任意）。
     */
    unit?: string;
    /**
     * 項目ハッシュ（任意）。
     */
    item_hash?: string;
  }[];
  /**
   * 使用した観測テンプレの template_id（任意）。
   */
  template_id?: string;
  /**
   * 自由記述メモ（任意）。
   */
  note?: string;
}
