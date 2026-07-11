// KRM-21/04/16 プロフィール + 統合ステータス（design-k3 §2.2/§2.3）。3 指標
// （Karma/Contribution/Market）を個別に投影で都度再計算（常駐 DB 禁止・不変条項①）。
// 研究スコアは Contribution 配下（独立 4 番目にしない・ADR-H-08）。BAN は公開表示・可逆
// （R2 イベントは削除しない・投影で都度判定・KRM-04）。public_safety は非公開設定不可。
// KRM-16 統合ステータスは append-only 履歴の読取投影まで（GUI 編集フォームは後波）。
import { Hono } from "hono";
import { TruthStore } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { projectLedger, isBanned, KARMA_TYPE, COIN_TYPE } from "./ledger-routes";
import { projectContribution, PT_TYPE, CONTRIBUTION_TYPE } from "./contribution";
import { projectRating } from "./market-rating-routes";
import { INTL_TRUST_MIN, INTL_TRUST_MAX } from "./economy-constants";

export const profileRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
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

export interface ProfileProjection {
  actor_id: string;
  karma: { value: number; count: number; ban: boolean };
  contribution: { axes: Awaited<ReturnType<typeof projectContribution>>["axes"]; research_score: number };
  market: { rating: Awaited<ReturnType<typeof projectRating>> };
  public_safety_locked: readonly string[];
  configurable_public_fields: readonly string[];
  intl_trust: number; // 0-100
}

export async function projectProfile(s: TruthStore, actorId: string): Promise<ProfileProjection> {
  const ledger = await projectLedger(s, actorId);
  const ban = await isBanned(s, actorId);
  const contribution = await projectContribution(s, actorId);
  const rating = await projectRating(s, actorId);
  // ponytail: intl_trust は karma 値からの決定論投影（0-100）。国境跨ぎ重み付けの本式は
  // 後波。karma_value∈[-100,100] → 50+value/2 ∈[0,100]（都度再計算・常駐 DB 禁止）。
  const intl_trust = clampTrust(50 + ledger.karma_value / 2);
  return {
    actor_id: actorId,
    karma: { value: ledger.karma_value, count: ledger.karma_count, ban },
    contribution: { axes: contribution.axes, research_score: contribution.axes.research.score },
    market: { rating },
    public_safety_locked: PUBLIC_SAFETY_FIELDS,
    configurable_public_fields: CONFIGURABLE_FIELDS,
    intl_trust,
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
