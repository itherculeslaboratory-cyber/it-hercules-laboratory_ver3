// C5 K1 マチアプ嗜好学習 API (design-k1 §1.1/§1.4 / V3-IND-07). PROTECTED. A single
// append-only preference_event carries kind∈{swipe,pass,valuecheck}, y∈{+1,-1} and
// a feature vector x. The preference weight is the online-learning reduce
// w ← w + α·y·x (α=LEARNING_RATE); ranking is inner-product descending and the
// score is NEVER exposed in the response. envelope()/store()/dataOf() inlined per
// the projectLedger precedent (批評家#3).
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { LEARNING_RATE } from "./observation-constants";

export const matchRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const MATCH_TYPE = "ihl.match.preference.v1";
const MATCH_SCHEMA = "schemas/events/match-preference.schema.json";

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}
function envelope(actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id: ulid(),
    source: "apps/api",
    type: MATCH_TYPE,
    time: new Date().toISOString(),
    dataschema: MATCH_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}

const numArray = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((n): n is number => typeof n === "number") : [];

/**
 * Preference weight vector for one actor: reduce the actor's own preference_events
 * with w ← w + α·y·x (α=LEARNING_RATE). Deterministic — created_at asc, pref_id
 * tie-break. The vector grows to the longest feature length seen. Pure fn of Truth.
 */
export async function projectPreferenceWeights(s: TruthStore, actorId: string): Promise<number[]> {
  const rows = (await s.listEvents(`truth/${MATCH_TYPE}/${actorId}-`))
    .map(dataOf)
    .filter((d) => d.actor_id === actorId)
    .sort((a, b) =>
      String(a.created_at).localeCompare(String(b.created_at)) ||
      String(a.pref_id).localeCompare(String(b.pref_id)),
    );
  const w: number[] = [];
  for (const d of rows) {
    const x = numArray(d.features);
    const y = typeof d.y === "number" ? d.y : 0;
    for (let i = 0; i < x.length; i++) w[i] = (w[i] ?? 0) + LEARNING_RATE * y * x[i];
  }
  return w;
}

// exported for V3-UIX-21 (obs-search rerank personalization): the same
// deterministic dot product the ranking above uses, reused rather than
// re-implemented at the call site.
export const dot = (w: number[], x: number[]): number => {
  let s = 0;
  for (let i = 0; i < Math.min(w.length, x.length); i++) s += w[i] * x[i];
  return s;
};

/**
 * Rank candidates by inner product w·x descending. The score is computed for
 * ordering but STRIPPED from the returned objects (IND-07: score must not leak).
 * Stable for equal scores (original order preserved).
 */
export function rankByPreference<T extends { features?: unknown }>(w: number[], candidates: T[]): Omit<T, "features">[] {
  return candidates
    .map((cand, i) => ({ cand, i, score: dot(w, numArray(cand.features)) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ cand }) => {
      const { features: _f, ...rest } = cand as T & { features?: unknown };
      return rest as Omit<T, "features">;
    });
}

// distinct items the actor has weighed in on → latest feature vector per item.
async function candidatePool(s: TruthStore, actorId: string): Promise<{ item_id: string; features: number[] }[]> {
  const rows = (await s.listEvents(`truth/${MATCH_TYPE}/${actorId}-`))
    .map(dataOf)
    .filter((d) => d.actor_id === actorId)
    .sort((a, b) =>
      String(a.created_at).localeCompare(String(b.created_at)) ||
      String(a.pref_id).localeCompare(String(b.pref_id)),
    );
  const byItem = new Map<string, number[]>();
  for (const d of rows) byItem.set(String(d.item_id), numArray(d.features)); // last write = latest features
  return [...byItem.entries()].map(([item_id, features]) => ({ item_id, features }));
}

// ── routes ─────────────────────────────────────────────────────────────────────

// POST /match/preference — append one preference_event (IND-07). kind/y/features
// shape is enforced by match-preference schema (kind enum, y∈{1,-1}, number[]).
matchRoutes.post("/match/preference", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");
  const data: Record<string, unknown> = {
    pref_id: ulid(),
    actor_id: actorId,
    item_id: body.item_id,
    kind: body.kind,
    y: body.y,
    features: body.features,
    created_at: typeof body.created_at === "string" ? body.created_at : new Date().toISOString(),
  };
  const key = `truth/${MATCH_TYPE}/${actorId}-${String(data.pref_id)}.json`;
  const res = await store(c).putEventAt(key, envelope(actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_PREFERENCE", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_PREFERENCE", key: res.key }, 409);
  return c.json({ pref_id: data.pref_id, kind: data.kind }, 201);
});

// GET /match/ranking — actor's candidate pool ranked by learned preference weights
// (IND-07). Inner-product descending; score is NOT part of the response.
matchRoutes.get("/match/ranking", async (c) => {
  const actorId = c.get("actorId");
  const s = store(c);
  const w = await projectPreferenceWeights(s, actorId);
  const ranking = rankByPreference(w, await candidatePool(s, actorId));
  return c.json({ actor_id: actorId, ranking });
});
