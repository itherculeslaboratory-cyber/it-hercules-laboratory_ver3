// C5 K1 マチアプ嗜好学習 API (design-k1 §1.1/§1.4 / V3-IND-07). PROTECTED. A single
// append-only preference_event carries kind∈{swipe,pass,valuecheck}, y∈{+1,-1} and
// a feature vector x. The preference weight is the online-learning reduce
// w ← w + α·y·x (α=LEARNING_RATE); ranking is inner-product descending and the
// score is NEVER exposed in the response. envelope()/store()/dataOf() inlined per
// the projectLedger precedent (批評家#3).
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { LEARNING_RATE, MATCH_AUC_VALID_THRESHOLD } from "./observation-constants";

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

// ── V3-IND-08 convergence evaluation ────────────────────────────────────────────
// The formula engine itself is already O(events)·no GPU·no black-box model (the
// w<-w+alpha*y*x reduce above); IND-08 additionally requires an append-only
// EVALUATION LOG that judges convergence (Precision@K/AUC/score separation/vector
// change/learning stability) and can be fully reconstructed from history even
// after LEARNING_RATE or the formula changes. Nothing here is resident state —
// every number below is recomputed from the same preference_event history that
// projectPreferenceWeights already reduces (不変条項①・"評価ログはDELETE禁止"
// is automatic: preference_event is Truth-store append-only, so re-deriving with
// a different learning rate/formula just re-runs this function over the SAME
// untouched events).

function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

// distinct items with their LATEST (features, true label y) — same reduction
// rule as candidatePool (last write wins) but also keeps y for evaluation.
async function labeledItems(s: TruthStore, actorId: string): Promise<{ item_id: string; features: number[]; y: number }[]> {
  const rows = (await s.listEvents(`truth/${MATCH_TYPE}/${actorId}-`))
    .map(dataOf)
    .filter((d) => d.actor_id === actorId)
    .sort((a, b) =>
      String(a.created_at).localeCompare(String(b.created_at)) ||
      String(a.pref_id).localeCompare(String(b.pref_id)),
    );
  const byItem = new Map<string, { features: number[]; y: number }>();
  for (const d of rows) {
    byItem.set(String(d.item_id), { features: numArray(d.features), y: typeof d.y === "number" ? d.y : 0 });
  }
  return [...byItem.entries()].map(([item_id, v]) => ({ item_id, ...v }));
}

// raw event stream in learning order (features/y per event, NOT deduped by item —
// this feeds vector_change/learning_stability which are about the update STEPS).
async function orderedPreferenceEvents(s: TruthStore, actorId: string): Promise<{ features: number[]; y: number }[]> {
  const rows = (await s.listEvents(`truth/${MATCH_TYPE}/${actorId}-`))
    .map(dataOf)
    .filter((d) => d.actor_id === actorId)
    .sort((a, b) =>
      String(a.created_at).localeCompare(String(b.created_at)) ||
      String(a.pref_id).localeCompare(String(b.pref_id)),
    );
  return rows.map((d) => ({ features: numArray(d.features), y: typeof d.y === "number" ? d.y : 0 }));
}

/**
 * AUC via the Mann-Whitney rank-sum formula (average rank on ties) — the
 * standard closed-form equivalent of "probability a random positive outranks a
 * random negative". null when one class is absent (undefined AUC).
 */
function auc(scored: { score: number; y: number }[]): number | null {
  const pos = scored.filter((s) => s.y > 0).length;
  const neg = scored.filter((s) => s.y < 0).length;
  if (!pos || !neg) return null;
  const sorted = scored.slice().sort((a, b) => a.score - b.score);
  const ranks: number[] = new Array(sorted.length);
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].score === sorted[i].score) j++;
    const avgRank = (i + 1 + (j + 1)) / 2; // 1-based, averaged over the tied block
    for (let k = i; k <= j; k++) ranks[k] = avgRank;
    i = j + 1;
  }
  let rankSumPos = 0;
  for (let k = 0; k < sorted.length; k++) if (sorted[k].y > 0) rankSumPos += ranks[k];
  return (rankSumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}

/** Precision@K: of the top-K by score, the fraction whose true label is +1. */
function precisionAtK(scored: { score: number; y: number }[], k: number): number | null {
  if (!scored.length) return null;
  const kk = Math.min(k, scored.length);
  const top = scored.slice().sort((a, b) => b.score - a.score).slice(0, kk);
  return top.filter((s) => s.y > 0).length / kk;
}

/** Score separation度: mean(score|y=+1) - mean(score|y=-1). null if one class absent. */
function scoreSeparation(scored: { score: number; y: number }[]): number | null {
  const pos = avg(scored.filter((s) => s.y > 0).map((s) => s.score));
  const neg = avg(scored.filter((s) => s.y < 0).map((s) => s.score));
  return pos === null || neg === null ? null : pos - neg;
}

export interface ConvergenceReport {
  actor_id: string;
  n_events: number;
  auc: number | null;
  precision_at_k: { k: number; value: number | null };
  score_separation: number | null;
  vector_change: number;
  learning_stability_index: number | null;
  converged: boolean; // AUC >= MATCH_AUC_VALID_THRESHOLD (IND-08: "0.7以上で有効")
}

/**
 * Convergence evaluation (IND-08). vector_change = magnitude of the LAST update
 * step (alpha*|y|*||x||); learning_stability_index = 1 - coefficient_of_variation
 * of all update-step magnitudes (1=perfectly uniform steps, 0=high variance),
 * null when fewer than 2 events (undefined variance). Deterministic pure fn of
 * Truth — no resident evaluation state, no GPU, O(events + distinct items).
 */
export async function projectMatchConvergence(s: TruthStore, actorId: string, k = 5): Promise<ConvergenceReport> {
  const events = await orderedPreferenceEvents(s, actorId);
  const w = await projectPreferenceWeights(s, actorId);
  const items = await labeledItems(s, actorId);
  const scored = items.map((it) => ({ score: dot(w, it.features), y: it.y }));

  const stepMagnitudes = events.map((e) => LEARNING_RATE * Math.abs(e.y) * Math.sqrt(e.features.reduce((s2, v) => s2 + v * v, 0)));
  const vectorChange = stepMagnitudes.length ? stepMagnitudes[stepMagnitudes.length - 1] : 0;
  let stability: number | null = null;
  if (stepMagnitudes.length >= 2) {
    const m = avg(stepMagnitudes)!;
    const variance = stepMagnitudes.reduce((s2, x) => s2 + (x - m) ** 2, 0) / stepMagnitudes.length;
    stability = m > 0 ? Math.max(0, 1 - Math.sqrt(variance) / m) : 1;
  }

  const aucValue = auc(scored);
  return {
    actor_id: actorId,
    n_events: events.length,
    auc: aucValue,
    precision_at_k: { k: Math.min(k, scored.length), value: precisionAtK(scored, k) },
    score_separation: scoreSeparation(scored),
    vector_change: vectorChange,
    learning_stability_index: stability,
    converged: aucValue !== null && aucValue >= MATCH_AUC_VALID_THRESHOLD,
  };
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

// GET /match/convergence — evaluation log (Precision@K/AUC/score separation/
// vector change/learning stability), reconstructed from the append-only
// preference_event history (IND-08). ?k= overrides the Precision@K cutoff.
matchRoutes.get("/match/convergence", async (c) => {
  const actorId = c.get("actorId");
  const kParam = Number(c.req.query("k"));
  const k = Number.isInteger(kParam) && kParam > 0 ? kParam : 5;
  return c.json(await projectMatchConvergence(store(c), actorId, k));
});
