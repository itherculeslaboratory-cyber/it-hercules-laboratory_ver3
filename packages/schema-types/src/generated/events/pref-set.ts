// GENERATED FILE — do not edit by hand.
// source: schemas/events/pref-set.schema.json
// title: User preference set event (ihl.pref.set.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 利用者の設定（locale / theme-pack / UI template / reduced-motion 上書き）の append-only イベント。Truth キー truth/ihl.pref.set.v1/<pref_set_id>.json。projectPreferences が actor 一致を created_at/ULID で last-write-wins に畳み込み（UPDATE でなく追記＝不変条項③）。
 */
export interface PrefSet {
  /**
   * 設定イベントの一意キー（envelope.id=ULID 由来・冪等キーではない）。
   */
  pref_set_id: string;
  /**
   * 設定した本人の actor_id（本人スコープ V3-AUT-17）。
   */
  actor_id: string;
  /**
   * 選択 locale（BCP-47・任意・未設定は DEFAULT_LOCALE=ja）。
   */
  locale?: string;
  /**
   * 選択 theme-pack ID（built-in slug または fork ULID・任意）。
   */
  theme_pack_id?: string;
  /**
   * 選択 UI template ID（任意）。
   */
  template_id?: string;
  /**
   * モーション低減の明示上書き（任意・system=OS 追従）。
   */
  reduced_motion_override?: "system" | "reduce" | "no-preference";
  /**
   * 所属国(ISO 3166-1 alpha-2・任意・round-16裁定 V3-AUT-35/I18-02: UI非表示の内部属性。用途は規制/合法性の国別フィルタリング・行政介入スコープ(V3-GOV-35)・翻訳/通関/送料判定(V3-I18-17)に限定。国際信頼スコア等への汎用拡張は未裁定=対象外)。
   */
  country?: string;
  /**
   * V3-AUT-10 オンボーディングで確定する表示名(handle)。actor_id生ハッシュの代わりに表示する公開ニックネーム。setup-profile画面でlocaleと同時に確定し、この値の有無がonboardingComplete判定(handle未設定=false)を兼ねる。
   */
  handle?: string;
  /**
   * UI 露出レベル(V3-UIX-43・/me/settings 集約)。dev/admin は screen-def の開発者向けノード(未整備計測・内部ID等)の表示切替に使う自己申告フラグ。サーバ側の権限判定を置き換えない(表示のみ・任意・既定 user)。
   */
  ui_exposure?: "user" | "dev" | "admin";
  /**
   * Push 通知の利用者選好(V3-UIX-43)。実際の配信基盤(VAPID鍵・購読エンドポイント)は本番鍵投入を伴う人間ゲート(§5)であり本フィールドは自己管理設定の保持のみ(任意・既定 off)。
   */
  push_notifications_enabled?: "on" | "off";
  /**
   * V3-UIX-80 取引前準備: 受取方法の選好(局留め受取 or 自宅配送への配送先設定済み)。実住所は保持しない(V3-SEC-11/V3-MKT-20の郵便局留め・URL中継設計に整合するカテゴリのみ・任意)。
   */
  delivery_pref?: "post_office_hold" | "home_delivery";
  /**
   * V3-UIX-80 取引前準備: 銀行振込の受け取り準備(相手への口座共有・振込コード確認)が済んでいるかの自己申告(任意)。実口座番号はシステムが保持しない(V3-SEC-06)。
   */
  bank_transfer_ready?: "yes" | "no";
  /**
   * ヘッダー常駐「観測対象」グローバル文脈スイッチ(HDR-1/R112/R115・c9-structure-canon.md §1・§1c層1=学術分類)の選択種(任意・空文字/未設定=すべて)。individual-routes.ts の既存 ?species= 完全一致フィルタ(大小無視)と同じ値域。他フィールドと異なり minLength を課さない — 空文字PATCHが『すべてに戻す』の唯一の表現(ヘッダーの既定=空はsentinelでなく実際の非フィルタ状態そのもの)。
   */
  scope_species?: string;
  /**
   * ヘッダー常駐「観測対象」グローバル文脈スイッチの選択血統ブランドタグ(任意・空文字/未設定=すべて。c9-structure-canon.md §1c層2=育種ブランド・V3-IND-34 lineage_id と同一値域。実の親子エッジ=層3とは別軸)。scope_species と同じ理由でminLengthなし(空文字=クリア)。
   */
  scope_lineage_id?: string;
  /**
   * カテゴリ別通知設定(V3-UIX-42)。karma系イベントの通知チャネル選好。実配信基盤(VAPID鍵・購読エンドポイント/メール送信鍵)は本番鍵投入を伴う人間ゲートであり本フィールドは設定の保持のみ(任意)。
   */
  notify_karma?: "off" | "push" | "mail" | "push+mail";
  /**
   * カテゴリ別通知設定(V3-UIX-42)。platinum系イベントの通知チャネル選好。実配信基盤は人間ゲートにつき本フィールドは設定の保持のみ(任意)。
   */
  notify_platinum?: "off" | "push" | "mail" | "push+mail";
  /**
   * カテゴリ別通知設定(V3-UIX-42)。dm系イベントの通知チャネル選好。実配信基盤は人間ゲートにつき本フィールドは設定の保持のみ(任意)。
   */
  notify_dm?: "off" | "push" | "mail" | "push+mail";
  /**
   * カテゴリ別通知設定(V3-UIX-42)。trade系イベントの通知チャネル選好。実配信基盤は人間ゲートにつき本フィールドは設定の保持のみ(任意)。
   */
  notify_trade?: "off" | "push" | "mail" | "push+mail";
  /**
   * カテゴリ別通知設定(V3-UIX-42)。system系イベントの通知チャネル選好。実配信基盤は人間ゲートにつき本フィールドは設定の保持のみ(任意)。
   */
  notify_system?: "off" | "push" | "mail" | "push+mail";
  /**
   * サイレント時間帯(DND)開始時刻(V3-UIX-42・HH:MM・registry.json V3-UIX-42明示値による既定22:00・任意)。
   */
  dnd_start?: string;
  /**
   * サイレント時間帯(DND)終了時刻(V3-UIX-42・HH:MM・registry.json V3-UIX-42明示値による既定07:00・任意)。
   */
  dnd_end?: string;
  /**
   * 個体QR(物理ラベル・IND-15 qr_url)を観測者本人がスキャンした時の既定挙動(QRLINK-1・2026-08-08ユーザー裁定)。ask=毎回『追加観測しますか?/詳細画面に行きますか?』を聞く(既定)。observe/detail=聞かずに直行。観測者本人以外・未ログインは本設定に関わらず常に詳細画面のみ(追加観測不可)。
   */
  qr_individual_action?: "ask" | "observe" | "detail";
  /**
   * 発生時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
