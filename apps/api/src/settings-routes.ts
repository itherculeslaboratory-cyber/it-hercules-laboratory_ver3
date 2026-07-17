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

const PREF_TYPE = "ihl.pref.set.v1";
const PREF_SCHEMA = "schemas/events/pref-set.schema.json";
const SCHEMA_VERSION = "1";

// 投影が畳み込む選好フィールド(per-field last-write-wins)。country は round-16裁定
// (V3-AUT-35/I18-02)の内部必須属性(UI非表示)。KRM-21 profile-routes.ts の
// CONFIGURABLE_FIELDS が既に "country" を宣言済みで、この pref-set 経路が実体を持つ
// (V3-GOV-35 の同国スコープ判定が最初の利用先)。handle は V3-AUT-10 オンボーディング
// (setup-profile画面)で確定する表示名 — 既存の pref-set(append-only・per-actor
// last-write-wins)をそのまま再利用し、新規イベント型/routeを増やさない。
const PREF_FIELDS = ["locale", "theme_pack_id", "template_id", "reduced_motion_override", "country", "handle"] as const;

export const settingsRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

export type Preferences = {
  locale: string;
  theme_pack_id: string;
  template_id: string;
  reduced_motion_override: string;
  country: string;
  handle: string;
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
  };
  for (const e of events) {
    for (const k of PREF_FIELDS) {
      if (typeof e[k] === "string") acc[k] = e[k] as string;
    }
  }
  return acc;
}

// GET /me/preferences(041)— 本人の選好投影。
settingsRoutes.get("/me/preferences", async (c) => {
  const prefs = await projectPreferences(store(c), c.get("actorId"));
  return c.json(prefs);
});

// GET /me/settings(042)— preferences + account_meta 集約。
settingsRoutes.get("/me/settings", async (c) => {
  const actorId = c.get("actorId");
  const preferences = await projectPreferences(store(c), actorId);
  return c.json({ preferences, account: { actor_id: actorId } });
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
