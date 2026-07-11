// GENERATED FILE — do not edit by hand.
// source: schemas/events/match-preference.schema.json
// title: Match Preference data (ihl.match.preference.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * マチアプ嗜好 append-only イベントの data 部（単一 preference_event に swipe/pass/valuecheck を kind で分岐）。Truth キー truth/ihl.match.preference.v1/<actor_id>-<ulid>.json。projectPreferenceWeights が w←w+α·y·x で reduce（α=LEARNING_RATE）、rankByPreference は内積降順。score はレスポンス非露出。
 */
export interface MatchPreference {
  /**
   * 嗜好イベントの一意キー。
   */
  pref_id: string;
  /**
   * 評価者の actor_id（V3-AUT-17・嗜好ベクトルの学習主体）。
   */
  actor_id: string;
  /**
   * 評価対象アイテムの ID。
   */
  item_id: string;
  /**
   * 評価種別（swipe=採用 / pass=見送り / valuecheck=価値確認）。
   */
  kind: "swipe" | "pass" | "valuecheck";
  /**
   * 教師信号（+1=正 / -1=負）。w←w+α·y·x の y。
   */
  y: 1 | -1;
  /**
   * アイテムの特徴ベクトル x（内積 w·x の入力）。
   */
  features: number[];
  /**
   * 評価時刻（RFC3339）。
   */
  created_at: string;
}
