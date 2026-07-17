// KRM-21/04/16 プロフィール + 統合ステータス（design-k3 §2.2/§2.3）。3 指標
// （Karma/Contribution/Market）を個別に投影で都度再計算（常駐 DB 禁止・不変条項①）。
// 研究スコアは Contribution 配下（独立 4 番目にしない・ADR-H-08）。BAN は公開表示・可逆
// （R2 イベントは削除しない・投影で都度判定・KRM-04）。public_safety は非公開設定不可。
// KRM-16 統合ステータスは append-only 履歴の読取投影まで（GUI 編集フォームは後波）。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { projectLedger, isBanned, KARMA_TYPE, COIN_TYPE } from "./ledger-routes";
import { projectContribution, PT_TYPE, CONTRIBUTION_TYPE } from "./contribution";
import { projectRating } from "./market-rating-routes";
import { INTL_TRUST_MIN, INTL_TRUST_MAX } from "./economy-constants";
import { projectPreferences } from "./settings-routes";

export const profileRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

// c8 UI磨き第2弾#5(受領10・actor_id 生ハッシュ露出の解消): 表示名は
// ind-name-event.schema.json と同型の「改名は追記」パターン(new event type,
// additive)。既存 profile/pref 型はリネームしない。V3-AUT-08 の @handle(一意・
// 不変ID)とは別概念 — 一意性もモデレーションも持たない自己申告ラベル。
const DISPLAY_NAME_TYPE = "ihl.actor.display_name.v1";
const DISPLAY_NAME_SCHEMA = "schemas/events/actor-display-name.schema.json";
const DISPLAY_NAME_MAX = 40;

function idOf(e: Record<string, unknown>): string {
  return typeof e.id === "string" ? e.id : "";
}

// actor_id 前方一致の prefix scan(individual-routes.ts projectName の
// individual_id 前方一致と同型・O(k))。created_at 昇順、ULID の envelope.id を
// tie-break にして決定論的に最新1件へ畳み込む(同時刻の複数設定でも常に同じ勝者)。
export async function projectDisplayName(s: TruthStore, actorId: string): Promise<string | null> {
  const rows = (await s.listEvents(`truth/${DISPLAY_NAME_TYPE}/${actorId}-`))
    .filter((e) => dataOf(e).actor_id === actorId)
    .map((e) => ({
      ev: idOf(e),
      name: String(dataOf(e).display_name ?? ""),
      created_at: String(dataOf(e).created_at ?? ""),
    }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.ev.localeCompare(b.ev));
  return rows.length ? rows[rows.length - 1].name || null : null;
}

// KRM-21: 常に公開（非公開設定不可）＝取引実績/カルマ/悪レビュー/公開 ON 不服申立て。
export const PUBLIC_SAFETY_FIELDS = ["trade_record", "karma", "bad_reviews", "public_optin_appeal"] as const;
// KRM-21: 公開設定可（本人が公開/非公開を選べる）＝国/言語/文化タグ/自己紹介/アイコン。
export const CONFIGURABLE_FIELDS = ["country", "language", "culture_tags", "bio", "icon"] as const;

// public_safety フィールドは非公開設定を拒否（常に公開）。configurable のみ true。
export function canSetPrivate(field: string): boolean {
  return (CONFIGURABLE_FIELDS as readonly string[]).includes(field);
}

const clampTrust = (v: number): number => Math.min(INTL_TRUST_MAX, Math.max(INTL_TRUST_MIN, v));

export interface PiiReadiness {
  delivery_pref: string;
  bank_transfer_ready: string;
  all_set: "yes" | "no";
}

export interface ProfileProjection {
  actor_id: string;
  display_name: string | null;
  karma: { value: number; count: number; ban: boolean };
  contribution: { axes: Awaited<ReturnType<typeof projectContribution>>["axes"]; research_score: number };
  market: { rating: Awaited<ReturnType<typeof projectRating>> };
  public_safety_locked: readonly string[];
  configurable_public_fields: readonly string[];
  intl_trust: number; // 0-100
  pii_readiness: PiiReadiness;
}

// V3-UIX-80: 取引前PII設定(局留め受取/自宅配送の選好・銀行振込受け取り準備)の完了判定。
// 実住所・実口座番号は保持しない(V3-SEC-06/11) — delivery_pref/bank_transfer_ready は
// settings-routes.ts の pref-set(既存 append-only 選好)の2フィールドのみを見る自己申告。
// all_set は両方が非空("bank_transfer_ready"は"yes"必須)の時のみ"yes"(都度再計算)。
export function computePiiReadiness(prefs: { delivery_pref: string; bank_transfer_ready: string }): PiiReadiness {
  const complete = prefs.delivery_pref !== "" && prefs.bank_transfer_ready === "yes";
  return {
    delivery_pref: prefs.delivery_pref,
    bank_transfer_ready: prefs.bank_transfer_ready,
    all_set: complete ? "yes" : "no",
  };
}

export async function projectProfile(s: TruthStore, actorId: string): Promise<ProfileProjection> {
  const ledger = await projectLedger(s, actorId);
  const ban = await isBanned(s, actorId);
  const contribution = await projectContribution(s, actorId);
  const rating = await projectRating(s, actorId);
  const display_name = await projectDisplayName(s, actorId);
  const prefs = await projectPreferences(s, actorId);
  // ponytail: intl_trust は karma 値からの決定論投影（0-100）。国境跨ぎ重み付けの本式は
  // 後波。karma_value∈[-100,100] → 50+value/2 ∈[0,100]（都度再計算・常駐 DB 禁止）。
  const intl_trust = clampTrust(50 + ledger.karma_value / 2);
  return {
    actor_id: actorId,
    display_name,
    karma: { value: ledger.karma_value, count: ledger.karma_count, ban },
    contribution: { axes: contribution.axes, research_score: contribution.axes.research.score },
    market: { rating },
    public_safety_locked: PUBLIC_SAFETY_FIELDS,
    configurable_public_fields: CONFIGURABLE_FIELDS,
    intl_trust,
    pii_readiness: computePiiReadiness(prefs),
  };
}

// KRM-16 append-only 履歴（読取投影）: 本人の経済系イベントを時系列に並べる。
export interface StatusHistoryEntry {
  kind: "karma" | "coin" | "pt" | "contribution";
  at: string;
  detail: Record<string, unknown>;
}

async function projectStatusHistory(s: TruthStore, actorId: string): Promise<StatusHistoryEntry[]> {
  const pick = async (
    type: string, kind: StatusHistoryEntry["kind"], detail: (d: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<StatusHistoryEntry[]> =>
    (await s.listEvents(`truth/${type}/`))
      .map(dataOf)
      .filter((d) => d.actor_id === actorId)
      .map((d) => ({ kind, at: String(d.created_at ?? ""), detail: detail(d) }));

  const all = [
    ...(await pick(KARMA_TYPE, "karma", (d) => ({ layer: d.layer, delta: d.delta, reason_code: d.reason_code }))),
    ...(await pick(COIN_TYPE, "coin", (d) => ({ grant_amount: d.grant_amount, reason_code: d.reason_code }))),
    ...(await pick(PT_TYPE, "pt", (d) => ({ delta: d.delta, reason_code: d.reason_code }))),
    ...(await pick(CONTRIBUTION_TYPE, "contribution", (d) => ({ axis: d.axis, delta: d.delta, source: d.source }))),
  ];
  return all.sort((a, b) => a.at.localeCompare(b.at));
}

// POST /me/display-name — 表示名を追記(UPDATE でなく新規イベント・不変条項③)。
// 本人の actor_id 以外への代理設定はできない(V3-AUT-17・body の actor_id は無視)。
profileRoutes.post("/me/display-name", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const name = body && typeof body.display_name === "string" ? body.display_name.trim() : "";
  if (!name) return c.json({ error: "INVALID_DISPLAY_NAME", details: ["display_name required"] }, 400);
  if (name.length > DISPLAY_NAME_MAX) {
    return c.json({ error: "INVALID_DISPLAY_NAME", details: [`display_name must be <= ${DISPLAY_NAME_MAX} chars`] }, 400);
  }
  const actorId = c.get("actorId");
  const id = ulid();
  const data = { actor_id: actorId, display_name: name, created_at: new Date().toISOString() };
  // actor_id-prefixed key (ind-name-event の individual_id-prefix と同型) —
  // projectDisplayName の prefix scan と対応させる(putEvent 既定の type-only
  // キーだと actor 単位で絞り込めない)。
  const res = await store(c).putEventAt(`truth/${DISPLAY_NAME_TYPE}/${actorId}-${id}.json`, {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: DISPLAY_NAME_TYPE,
    time: data.created_at,
    dataschema: DISPLAY_NAME_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  });
  if (res.status === "invalid") return c.json({ error: "INVALID_DISPLAY_NAME", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_EVENT", key: res.key }, 409);
  return c.json({ display_name: name }, 201);
});

// GET /me/profile — 本人プロフィール（3 指標個別・BAN 公開表示）。
profileRoutes.get("/me/profile", async (c) => {
  return c.json(await projectProfile(store(c), c.get("actorId")));
});

// GET /users/{actor}/profile — 公開プロフィール（3 指標個別・BAN 公開表示・KRM-21/04）。
profileRoutes.get("/users/:actor/profile", async (c) => {
  return c.json(await projectProfile(store(c), c.req.param("actor")));
});

// GET /me/status — 統合ステータス + append-only 履歴（読取投影・KRM-16）。
profileRoutes.get("/me/status", async (c) => {
  const s = store(c);
  const actorId = c.get("actorId");
  const [profile, history] = await Promise.all([
    projectProfile(s, actorId),
    projectStatusHistory(s, actorId),
  ]);
  return c.json({ ...profile, history });
});
