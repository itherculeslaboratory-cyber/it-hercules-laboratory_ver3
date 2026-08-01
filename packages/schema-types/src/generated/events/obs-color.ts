// GENERATED FILE — do not edit by hand.
// source: schemas/events/obs-color.schema.json
// title: Observation Color data (ihl.obs.color.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * BPCMS v1.0(甲虫色彩計測標準規格・V3-OBS-13凍結)派生値レイヤーの append-only イベントの data 部。Truth キー truth/ihl.obs.color.v1/<capture_id>-<color_id>.json。生画像は無補正のまま保存(OBS-23)、Lab/HSVはここに『別レイヤー』としてのみ持つ(observation-constants.ts correctLabViaGreycard のコメント通り)。重い画素処理はクライアント側(ブラウザ)で実行し(V3-AIP-104/invariant①)、このイベントは計算済みの結果を保存するのみ。obs-capture.schema.jsonは変更しない(append-onlyの下で既存captureへ後から色を足せないため別イベント型にした・遡及の可否は別途HQ裁定=G79-3)。
 */
export interface ObsColor {
  /**
   * 色解析結果イベントの一意キー(解析のたびに新規)。
   */
  color_id: string;
  /**
   * 対象観測セッションの capture_id。
   */
  capture_id: string;
  /**
   * 実行者の actor_id(V3-AUT-17)。
   */
  actor_id: string;
  /**
   * CIE Lab値。correctLabViaGreycard によるグレーカード基準補正が適用済みなら補正後、未適用ならクライアント算出の生Labを保存する(補正の有無は本イベントには持たず、上位のsourceで判別する運用)。
   */
  lab: {
    l: number;
    a: number;
    b: number;
  };
  /**
   * HSV値(色相0-360・彩度/明度0-1)。
   */
  hsv: {
    h: number;
    s: number;
    v: number;
  };
  /**
   * BPCMS規格のバージョン。observation-constants.ts の BPCMS_VERSION 定数を使う(自前で書かない)。
   */
  bpcms_version: "1.0";
  /**
   * 解析対象領域の記述(任意。例: 'full'=写真全体平均。スポイト/px指定によるROI選択UIはV3-UIX-40・本発注のスコープ外のため、当面は 'full' のみを送る)。
   */
  region?: string;
  /**
   * 解析結果の出所(任意。例: 'client_upload_auto'=アップロード時にクライアントが自動計算)。
   */
  source?: string;
  /**
   * 実行時刻(RFC3339・任意)。
   */
  created_at?: string;
}
