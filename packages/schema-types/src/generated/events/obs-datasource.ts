// GENERATED FILE — do not edit by hand.
// source: schemas/events/obs-datasource.schema.json
// title: Observation DataSource declaration event (ihl.obs.datasource.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 外部API/センサーを宣言的に登録する DataSource ノードの append-only イベント（V3-OBS-64・★R64-7裁定によりこの最小版のスコープは『外部APIを1つ domain=datasource として登録できる』まで。Workerを自動で動かす domain=law の Law ノードは対象外）。★秘密フィールドを1つも持たない — headers は Authorization/APIキー等の認証情報を含まない非秘密ヘッダのみを保存する（サーバー側に秘密を保管しない・第20回裁定DK-1・V3-SEC-03整合）。認証が要る外部APIは本スキーマでは自動取得できず、利用者端末側での取得を要する（design19 T1-10 案A）。既存 obs-device.schema.json(V3-OBS-31・センサー実体)とは別要件であり、統合しない。
 */
export interface ObsDatasource {
  /**
   * DataSource ノードの一意キー（ULID）。
   */
  datasource_id: string;
  /**
   * 登録者の actor_id（セッション principal 強制・V3-AUT-17）。
   */
  actor_id: string;
  /**
   * HTTPメソッド（この最小版は認証不要の公開APIのみを想定）。
   */
  method: string;
  /**
   * 取得先URL。
   */
  url: string;
  /**
   * 取得間隔（秒）。cron が interval で取得する（本番cron設定はインフラ作業・実装艦のglob外）。
   */
  interval: number;
  /**
   * 取得結果の保存先キー/プレフィクス。
   */
  saveTo: string;
  /**
   * 応答のパース方式識別子。
   */
  parser: string;
  /**
   * ★秘密でない付随ヘッダのみ（例: Accept）。Authorization/APIキー等の認証情報を含めてはならない。
   */
  headers?: {
    [k: string]: string;
  };
  /**
   * 発生時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版（任意）。
   */
  schema_version?: string;
}
