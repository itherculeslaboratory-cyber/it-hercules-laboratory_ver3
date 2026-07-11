// GENERATED FILE — do not edit by hand.
// source: schemas/events/cusb-ingest.schema.json
// title: C-USB Ingest data (ihl.cusb.ingest.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 統合入力バス（C-USB）取り込みの append-only イベントの data 部。Truth キー truth/ihl.cusb.ingest.v1/<payload_hash>.json。validate→lineage/semantic 付与→保存の順で通し、payload_hash で改ざん検知（put-if-absent 409）。input_kind で入力種別を分岐。
 */
export interface CusbIngest {
  /**
   * 入力の種別（画面／API／センサ／ファイル／人手／ネットワーク）。
   */
  input_kind: "screen" | "api" | "sensor" | "file" | "human" | "network";
  /**
   * 取り込みペイロードのハッシュ。改ざん検知・冪等キー。
   */
  payload_hash: string;
  /**
   * 系譜メタ（入力元・変換過程）。取り込み時に付与。
   */
  lineage: {
    [k: string]: unknown;
  };
  /**
   * 意味付けメタ（分類・タグ等）。取り込み時に付与。
   */
  semantic: {
    [k: string]: unknown;
  };
  /**
   * 取り込み者の actor_id（V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 取り込み時刻（RFC3339・任意）。
   */
  created_at?: string;
}
