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
   * 観測対象への参照。'individual/<individual_id>'（V3-IND-01）または 'clutch/<clutch_id>'（クラッチの抜き取り計測・専用APIを持たず既存captureで表現 — C7 スライス2 wireframes-core5 §F3）。任意。
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
   * 発育段階の候補（自由記述・ユーザー入力のみ・V3-OBS-19)。species_candidate と同じ位置づけ（AI 候補は入れない・確定を強制しない）。任意。
   */
  life_stage_candidate?: string;
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
    /**
     * 計測値の出所（frozen provenance value_origin 9 値・任意=ADDITIVE。必須ゲートは appendMeasurement route 側で担保 V3-OBS-06）。
     */
    value_origin?:
      | "direct_observed"
      | "image_derived"
      | "environment_derived"
      | "lineage_derived"
      | "estimated"
      | "imputed"
      | "aggregate"
      | "model_inference"
      | "unknown";
  }[];
  /**
   * 使用した観測テンプレの template_id（任意）。
   */
  template_id?: string;
  /**
   * 入力経路（manual=手入力 / qr=QR 再開・任意 V3-OBS-20）。
   */
  entry_mode?: "manual" | "qr";
  /**
   * 亜種の候補（ユーザー入力のみ・任意 V3-OBS-62）。
   */
  subspecies_candidate?: string;
  /**
   * 亜種の確定者。常に user（AI 確定は不可・任意 V3-OBS-62）。
   */
  subspecies_confirmed_by?: "user";
  /**
   * 撮影時の環境条件（自動埋込・任意 V3-OBS-28）。
   */
  photo_conditions?: {
    /**
     * 気温（℃・任意）。
     */
    temp_c?: number;
    /**
     * 湿度（%・任意）。
     */
    humidity_pct?: number;
    /**
     * 撮影時刻（RFC3339）。
     */
    captured_at: string;
  };
  /**
   * 自由記述メモ（任意）。
   */
  note?: string;
  /**
   * commit時に宣言するデバイスID配列（任意・V3-OBS-17）。宣言するとDeviceBinding/Occupancyの区間が自動派生され、専用binding APIを別途呼ぶ必要がない（commit1回で完結）。
   */
  devices?: string[];
}
