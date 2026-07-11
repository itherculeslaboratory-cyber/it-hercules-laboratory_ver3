// GENERATED FILE — do not edit by hand.
// source: schemas/events/ind-master.schema.json
// title: Individual Master data (ihl.ind.master.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 個体マスタ登録イベント ihl.ind.master.v1 の data 部。Truth キー truth/ihl.ind.master.v1/<individual_id>.json。frozen individual-key（CL-06）と同じ識別足場だが Truth コア固定枠ではなく登録用。成長データフィールドは持たない（成長・観測は別イベントで append・投影で集約 V3-IND-02/13）。
 */
export interface IndMaster {
  /**
   * 個体の一意キー。既存観測・血統の参照先（frozen individual-key と同形式）。
   */
  individual_id: string;
  /**
   * 現物ラベルの表示テキスト（任意）。
   */
  local_label_text?: string;
  /**
   * 種（ユーザー確定のみ・任意。未確定はブランク）。
   */
  species?: string;
  /**
   * 誕生／孵化日（任意）。
   */
  birth_or_hatch_date?: string;
  /**
   * 入手経路の種別（自家繁殖／購入等・任意）。
   */
  source_type?: string;
  /**
   * 登録者の actor_id（セッション principal 強制・V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 登録時刻（RFC3339）。
   */
  created_at: string;
}
