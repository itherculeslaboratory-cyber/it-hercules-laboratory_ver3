// 設定/選好 route(design-k4 §1.1 routes 041-044,050,051)。選好は append-only
// ihl.pref.set.v1 を Truth へ追記(UPDATE でなく追記＝不変条項③)、GET は投影で
// last-write-wins を都度再計算(常駐 DB 禁止＝不変条項①)。全 route PROTECTED
// (index.ts の auth middleware が gate・actorId を set)。書込 data.actor_id は
// セッション principal で強制刻印(V3-AUT-17)。route 045(pii-session)は別クラスタ非実装。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { DEFAULT_LOCALE, DEFAULT_TEMPLATE_ID, DEFAULT_THEME_PACK_ID } from "./ui-constants";
import { listThemePacks } from "./theme-routes";

// exported for auth-routes.ts's dev-login (seeds the same shape onboarding
// completion would produce — see the /dev-login handler for why).
export const PREF_TYPE = "ihl.pref.set.v1";
export const PREF_SCHEMA = "schemas/events/pref-set.schema.json";
export const SCHEMA_VERSION = "1";

// 投影が畳み込む選好フィールド(per-field last-write-wins)。country は round-16裁定
// (V3-AUT-35/I18-02)の内部必須属性(UI非表示)。KRM-21 profile-routes.ts の
// CONFIGURABLE_FIELDS が既に "country" を宣言済みで、この pref-set 経路が実体を持つ
// (V3-GOV-35 の同国スコープ判定が最初の利用先)。handle は V3-AUT-10 オンボーディング
// (setup-profile画面)で確定する表示名 — 既存の pref-set(append-only・per-actor
// last-write-wins)をそのまま再利用し、新規イベント型/routeを増やさない。
const PREF_FIELDS = [
  "locale",
  "theme_pack_id",
  "template_id",
  "reduced_motion_override",
  "country",
  "handle",
  "ui_exposure",
  "push_notifications_enabled",
  "delivery_pref",
  "bank_transfer_ready",
  "scope_species",
  "scope_lineage_id",
  "notify_karma",
  "notify_platinum",
  "notify_dm",
  "notify_trade",
  "notify_system",
  "dnd_start",
  "dnd_end",
] as const;

// V3-UIX-42: カテゴリ別通知(発火点はuib07think T1-aの実測時点で0件=実配信基盤は
// 人間ゲート。本フィールドは設定の保持のみ)。畳み込み後、カテゴリ5キーが未設定の
// 場合のみ push_notifications_enabled(マスタースイッチ)から導出する。イベントの
// 書き換え・再発行はしない(投影の計算のみ=append-only不変条項③を崩さない)。
const NOTIFY_CATEGORY_FIELDS = [
  "notify_karma",
  "notify_platinum",
  "notify_dm",
  "notify_trade",
  "notify_system",
] as const;

export const settingsRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

// V3-I18-02(第22回裁定: ①アクセス元情報から国を自動推測して埋め、登録画面に確認用
// 表示。ユーザーは進むか手で直せる)。Cloudflare Workers はエッジで CF-IPCountry ヘッダを
// 自動付与する(新規依存0・GeoIP DB不要)ので、それをそのまま読むだけ。★サーバ側は
// この推測値を一切 append しない(不変条項③=append-onlyを崩さない・GETに副作用を
// 持たせない)。実際に country を確定させるのは既存の PATCH /me/preferences のまま
// (ユーザーが「進む」を押す=確認画面から country 付きで PATCH する想定)。
// 欠点(海外滞在・VPN経由だと誤ることがある)は呼び出し側(画面)が「確認用」と明示する前提。
function suggestedCountryFrom(c: { req: { header(name: string): string | undefined } }): string | undefined {
  const cc = (c.req.header("cf-ipcountry") ?? "").toUpperCase();
  if (!cc || cc === "XX" || cc === "T1") return undefined; // XX=Cloudflareの「不明」・T1=Tor
  return cc;
}

// prefs.country が未設定の時だけ country_suggested を上乗せする(既存フィールドの
// 形は一切変えない=既存の toEqual 厳密一致テストへの非破壊を保つ)。
function withCountrySuggestion<T extends { country: string }>(
  prefs: T,
  c: { req: { header(name: string): string | undefined } },
): T | (T & { country_suggested: string }) {
  if (prefs.country !== "") return prefs;
  const suggested = suggestedCountryFrom(c);
  return suggested ? { ...prefs, country_suggested: suggested } : prefs;
}

export type Preferences = {
  locale: string;
  theme_pack_id: string;
  template_id: string;
  reduced_motion_override: string;
  country: string;
  handle: string;
  ui_exposure: string;
  push_notifications_enabled: string;
  delivery_pref: string;
  bank_transfer_ready: string;
  scope_species: string;
  scope_lineage_id: string;
  notify_karma: string;
  notify_platinum: string;
  notify_dm: string;
  notify_trade: string;
  notify_system: string;
  dnd_start: string;
  dnd_end: string;
};

// 選好投影(都度再計算)。pref-set を prefix scan → actor 一致のみ → created_at/ULID
// 昇順に各イベントの present フィールドを既定へ per-field last-write-wins で畳み込む。
// PATCH が部分フィールドを追記しても後勝ちでマージされる。空なら既定値。
// ponytail: pref-type 全走査 O(n)。MVP 量なら十分・投影 index は別波(design-c2 §3.1)。
export async function projectPreferences(store: TruthStore, actorId: string): Promise<Preferences> {
  const events = (await store.listEvents(`truth/${PREF_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.actor_id === actorId)
    .sort((a, b) => {
      const ca = String(a.created_at ?? "");
      const cb = String(b.created_at ?? "");
      if (ca !== cb) return ca < cb ? -1 : 1;
      // 同時刻は ULID(pref_set_id)で決定的に順序付け。
      return String(a.pref_set_id ?? "") < String(b.pref_set_id ?? "") ? -1 : 1;
    });

  const acc: Preferences = {
    locale: DEFAULT_LOCALE,
    theme_pack_id: DEFAULT_THEME_PACK_ID,
    template_id: DEFAULT_TEMPLATE_ID,
    reduced_motion_override: "system",
    country: "", // 未設定(round-16: 国籍は任意の内部属性・既定は非選択)
    handle: "", // 未設定 = V3-AUT-10 onboardingComplete===false のゲート条件
    ui_exposure: "user", // V3-UIX-43: 既定は一般ユーザー表示(dev/adminは自己申告トグル)
    push_notifications_enabled: "off", // V3-UIX-43: 配信基盤は人間ゲート・既定オフ
    delivery_pref: "", // V3-UIX-80: 未設定 = 取引前ナッジの対象
    bank_transfer_ready: "", // V3-UIX-80: 未設定(≠"yes") = 取引前ナッジの対象
    scope_species: "", // HDR-1/R112/R115: ヘッダー観測対象セレクタ・未設定=すべて
    scope_lineage_id: "", // HDR-1/R112/R115: 同上・血統ブランドタグ層(層2)
    notify_karma: "", // V3-UIX-42: 未設定 = master(push_notifications_enabled)から導出
    notify_platinum: "", // 同上
    notify_dm: "", // 同上
    notify_trade: "", // 同上
    notify_system: "", // 同上
    dnd_start: "22:00", // V3-UIX-42: registry.json明示値の既定(DNDは既定で有効)
    dnd_end: "07:00", // 同上
  };
  for (const e of events) {
    for (const k of PREF_FIELDS) {
      if (typeof e[k] === "string") acc[k] = e[k] as string;
    }
  }
  // 既存ユーザーのmasterスイッチ引き継ぎ(uib07think T2案A): カテゴリ5キーが未設定
  // (空文字)の場合のみ push_notifications_enabled から導出する(on→push/off→off)。
  // 既にカテゴリが明示設定されていればそれを優先し上書きしない。
  const masterDerived = acc.push_notifications_enabled === "on" ? "push" : "off";
  for (const k of NOTIFY_CATEGORY_FIELDS) {
    if (acc[k] === "") acc[k] = masterDerived;
  }
  // ★優先順位(uib07think判断4・実配信は本Ship1の範囲外=発火点0件): 実配信を
  // 実装する側は必ず「master=off の時はカテゴリの値に関わらず何も送らない」を守ること
  // (masterが優先。ここでのカテゴリ値はmaster=offでも"push"等になり得る=あくまで
  // カテゴリ単体の選好の保持であり、送信可否の最終判定ではない)。
  return acc;
}

// GET /me/preferences(041)— 本人の選好投影。country 未設定時のみ V3-I18-02 の
// 確認用推測値(country_suggested)を上乗せする(サーバは何もappendしない)。
settingsRoutes.get("/me/preferences", async (c) => {
  const prefs = await projectPreferences(store(c), c.get("actorId"));
  return c.json(withCountrySuggestion(prefs, c));
});

// GET /me/settings(042)— preferences + account_meta 集約。
settingsRoutes.get("/me/settings", async (c) => {
  const actorId = c.get("actorId");
  const preferences = await projectPreferences(store(c), actorId);
  return c.json({ preferences: withCountrySuggestion(preferences, c), account: { actor_id: actorId } });
});

// GET /settings(043,050)— 利用可能 locale・theme-pack 一覧・feature flags を都度算出。
// feature flags は不変条項①(LLM/Vision/FAISS 既定 OFF)を反映。
settingsRoutes.get("/settings", async (c) => {
  const themePacks = await listThemePacks(store(c));
  return c.json({
    locales: [DEFAULT_LOCALE, "en"],
    theme_packs: themePacks,
    feature_flags: { llm: false, vision: false, faiss: false },
  });
});

// PATCH /me/preferences(044,051)— 選好を append(UPDATE でなく追記)。body の選好
// フィールドを data へ通し、envelope 検証(additionalProperties:false / enum)が gate:
// 余剰キー・enum 外(reduced_motion_override:"bogus" 等)は 400。actor_id は強制刻印。
settingsRoutes.patch("/me/preferences", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return c.json({ error: "INVALID_PREFERENCES", details: ["body required"] }, 400);
  }
  const actorId = c.get("actorId");
  const id = ulid();
  // body を通す(未知キーは additionalProperties:false で 400)。pref_set_id/actor_id/
  // created_at/schema_version はサーバ確定値で上書き。
  const data: Record<string, unknown> = {
    ...body,
    pref_set_id: id,
    actor_id: actorId,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  const res = await store(c).putEvent({
    specversion: "1.0",
    id,
    source: "apps/api",
    type: PREF_TYPE,
    time: new Date().toISOString(),
    dataschema: PREF_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  });
  if (res.status === "invalid") return c.json({ error: "INVALID_PREFERENCES", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_PREFERENCES", key: res.key }, 409);
  return c.json(await projectPreferences(store(c), actorId), 200);
});
