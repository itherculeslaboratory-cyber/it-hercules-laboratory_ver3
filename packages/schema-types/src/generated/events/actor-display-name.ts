// GENERATED FILE — do not edit by hand.
// source: schemas/events/actor-display-name.schema.json
// title: Actor Display Name Event data (ihl.actor.display_name.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * actor_id にひも付く表示名の append-only イベント（c8 UI磨き第2弾#5・actor_id 生ハッシュ露出の解消）。Truth キー truth/ihl.actor.display_name.v1/<actor_id>-<ulid>.json。ind-name-event.schema.json と同型の「改名は追記・UPDATE禁止」パターン: projectDisplayName が created_at(ULID tie-break)昇順で最新表示名に畳み込む。表示名は一意性を持たない自己申告のラベルであり、V3-AUT-08 の @handle（一意・不変の ID ゲート）とは別概念（handle は別要件・別波・本イベントは handle を代替しない）。表示名未設定の actor は呼び出し側（actor 表示プリミティブ）が短縮 actor_id ハッシュへ fallback する。
 */
export interface ActorDisplayName {
  /**
   * 表示名を設定した本人の actor_id（本人スコープ V3-AUT-17・自分以外の名を代理設定できない）。
   */
  actor_id: string;
  /**
   * 自己申告の表示名（一意性なし・不変性なし・不適切語のモデレーションは対象外＝後波）。
   */
  display_name: string;
  /**
   * 設定時刻（RFC3339）。projectDisplayName の最新判定キー。
   */
  created_at: string;
}
