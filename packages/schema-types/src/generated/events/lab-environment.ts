// GENERATED FILE — do not edit by hand.
// source: schemas/events/lab-environment.schema.json
// title: Lab environment source event (ihl.src.lab_environment.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 研究室環境コンテキスト登録イベント ihl.src.lab_environment.v1 の data 部(V3-OBS-72)。placement(C5 K7 design-k7 §1.2)を拡張し、その置き場所が属する研究室の部屋・棚配置・空調プロファイル・センサー設置位置を記述する。1 placement_id に対し複数回append可(再配置・空調変更の履歴)、読み出しは created_at 最新の1件を『現在の環境記述』として投影する(placement.schema.json 同様 Tier A INSERT ONLY・常駐DBなし・都度再計算)。値なしフィールドは省略(null/空文字禁止)。
 */
export interface LabEnvironment {
  /**
   * 環境記述レコードの一意キー(ULID)。
   */
  lab_environment_id: string;
  /**
   * 登録者の actor_id(セッション principal 強制・V3-AUT-17)。
   */
  actor_id: string;
  /**
   * 紐づく設置場所(棚)の一意キー(placement.schema.json)。
   */
  placement_id: string;
  /**
   * 部屋・研究室の表示ラベル(例: 「飼育室2・北側」)。
   */
  room_label: string;
  /**
   * 空調(エアコン等)設定の自由記述(例: 「24℃・湿度55%設定」)。任意。
   */
  hvac_profile?: string;
  /**
   * センサー設置位置の自由記述(例: 「棚の中段・エアコン吹出口から2m」)。任意。
   */
  sensor_position?: string;
  /**
   * 登録時刻(RFC3339)。
   */
  created_at: string;
  /**
   * イベント型バージョン(ihl.src.lab_environment.v1)。
   */
  schema_version: string;
}
