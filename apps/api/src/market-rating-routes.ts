// MKT-27 取引評価(ADR-H-08 件数モデル)。評価は append-only ihl.mkt.rating.v1、
// good/normal/bad 件数と star_avg は投影で都度再計算(常駐 DB 禁止・不変条項①)。
// grade=bad は reason 必須(route + schema 二重強制)。GET は公開(認証済みなら誰でも
// 他人の集計を閲覧可)+低評価フィルタ(bad≥5 || karma≤0 || star_avg≤2)。全 route は
// index.ts §1.5 gate 経由 PROTECTED・書込 rater_id はセッション principal 強制(V3-AUT-17)。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { projectLedger } from "./ledger-routes";
import {
  LOW_RATING_BAD_THRESHOLD,
  LOW_RATING_KARMA_MAX,
  LOW_RATING_STAR_MAX,
} from "./economy-constants";

const RATING_TYPE = "ihl.mkt.rating.v1";
const RATING_SCHEMA = "schemas/events/mkt-rating.schema.json";
const SCHEMA_VERSION = "1"; // event schema は schema_version=string

export const marketRatingRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

// grade→星(good=5 / normal=3 / bad=1)。star_avg は受領評価の加重平均(ADR-H-08)。
const GRADE_STAR: Record<string, number> = { good: 5, normal: 3, bad: 1 };

export interface RatingSummary {
  actor_id: string;
  good: number;
  normal: number;
  bad: number;
  trades: number; // 受領評価の総数
  star_avg: number | null; // 評価なしは null(星条件を適用しない)
}

// 被評価者 actorId 宛の評価を prefix-scan で集計(都度再計算・本人以外も閲覧=公開)。
// ponytail: 評価型 prefix scan = O(n) 全走査。既存 projectLedger と同型・index は別波。
export async function projectRating(s: TruthStore, actorId: string): Promise<RatingSummary> {
  const mine = (await s.listEvents(`truth/${RATING_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.ratee_id === actorId);
  let good = 0;
  let normal = 0;
  let bad = 0;
  let starSum = 0;
  for (const d of mine) {
    const g = String(d.grade);
    if (g === "good") good++;
    else if (g === "normal") normal++;
    else if (g === "bad") bad++;
    starSum += GRADE_STAR[g] ?? 0;
  }
  const trades = good + normal + bad;
  return {
    actor_id: actorId,
    good,
    normal,
    bad,
    trades,
    star_avg: trades > 0 ? starSum / trades : null,
  };
}

// 低評価フィルタ(MKT-27)。bad≥5 || karma≤0 || star_avg≤2 のいずれかで true。
// star_avg=null(評価なし)は星条件を適用しない(null≤2 の JS 誤判定を避ける)。
export function lowRatingFlag(summary: RatingSummary, karmaValue: number): boolean {
  return (
    summary.bad >= LOW_RATING_BAD_THRESHOLD ||
    karmaValue <= LOW_RATING_KARMA_MAX ||
    (summary.star_avg !== null && summary.star_avg <= LOW_RATING_STAR_MAX)
  );
}

function envelope(id: string, raterId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: RATING_TYPE,
    time: new Date().toISOString(),
    dataschema: RATING_SCHEMA,
    provenance: { generator_kind: "human", actor_id: raterId },
    data,
  };
}

// POST /market/ratings — 取引評価を append。rater_id はセッション principal 強制。
// bad は reason 必須(route で 400・schema でも then.required で二重強制)。
marketRatingRoutes.post("/market/ratings", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const listingId = body && typeof body.listing_id === "string" ? body.listing_id : "";
  const rateeId = body && typeof body.ratee_id === "string" ? body.ratee_id : "";
  const grade = body && typeof body.grade === "string" ? body.grade : "";
  if (!listingId || !rateeId || !["good", "normal", "bad"].includes(grade)) {
    return c.json({ error: "INVALID_RATING", details: ["listing_id, ratee_id, grade required"] }, 400);
  }
  const reason = body && typeof body.reason === "string" ? body.reason.trim() : "";
  if (grade === "bad" && !reason) {
    return c.json({ error: "INVALID_RATING", details: ["reason required for grade=bad"] }, 400);
  }

  const raterId = c.get("actorId");
  const id = ulid();
  const data: Record<string, unknown> = {
    rating_id: id,
    listing_id: listingId,
    rater_id: raterId,
    ratee_id: rateeId,
    grade,
    auto: false,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (reason) data.reason = reason;
  if (Array.isArray(body?.tags)) data.tags = (body?.tags as unknown[]).filter((t) => typeof t === "string");
  if (typeof body?.comment === "string") data.comment = body.comment;

  const res = await store(c).putEvent(envelope(id, raterId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_RATING", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_RATING", key: res.key }, 409);
  return c.json({ rating_id: id }, 201);
});

// GET /market/users/{actor}/ratings — 公開の評価集計 + 低評価フィルタ(MKT-27)。
// karma は被評価者の投影値を読む(good/normal/bad と分離・投影で都度導出)。
marketRatingRoutes.get("/market/users/:actor/ratings", async (c) => {
  const actor = c.req.param("actor");
  const s = store(c);
  const summary = await projectRating(s, actor);
  const { karma_value } = await projectLedger(s, actor);
  return c.json({ ...summary, karma_value, low_rating: lowRatingFlag(summary, karma_value) });
});
