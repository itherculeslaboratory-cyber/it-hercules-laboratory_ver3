// C5 K1 タグ二層 API (design-k1 §1.1/§1.4 / V3-OBS-63/07/52). PROTECTED (index.ts
// gates + sets actorId). Tag Truth is the FROZEN tag-event (CL-13) — a single
// append-only record carrying ONE source_type, so it can only ever hold one layer.
// The ai/user two-layer view is DERIVED at aggregate time from source_type
// (machine→ai / human→user · 批評家#4); there is no per-append two-layer guard.
// envelope()/store()/dataOf() are inlined per the projectLedger precedent (they
// are module-private in observation-routes.ts / ledger-routes.ts · 批評家#3).
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { CONFIDENCE_ORDER } from "./observation-constants";

export const tagRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const TAG_TYPE = "ihl.obs.tag_event.v1";
const TAG_SCHEMA = "schemas/frozen/tag-event.schema.json";

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
    type: TAG_TYPE,
    time: new Date().toISOString(),
    dataschema: TAG_SCHEMA,
    // V3-AUT-17: the frozen tag-event data has no actor_id field, so the session
    // principal is stamped on the envelope provenance (same as POST /events).
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}

// ── derived layer (批評家#4): source_type carrying "human" → user, else ai ──────
function tagLayer(sourceType: unknown): "ai" | "user" {
  return typeof sourceType === "string" && /human/i.test(sourceType) ? "user" : "ai";
}

/**
 * Confidence grade ◎/○/△ from value_origin (OBS-07). Total over the frozen
 * 9-value provenance enum via CONFIDENCE_ORDER (自動取得>手入力>後日編集). A
 * measurement edited after the fact (is_manual_edit) is the least trusted tier
 * (後日編集) → △ regardless of origin. Pure/deterministic.
 */
export function confidenceGrade(measurement: Record<string, unknown>): "◎" | "○" | "△" {
  const origin = typeof measurement.value_origin === "string" ? measurement.value_origin : "unknown";
  if (measurement.is_manual_edit === true) return "△"; // 後日編集 = lowest tier
  return (CONFIDENCE_ORDER as Record<string, "◎" | "○" | "△">)[origin] ?? "△";
}

export interface TagAggregate {
  target_type: string;
  target_id: string;
  ai_tags: string[]; // currently-on tags derived from machine events
  user_tags: string[]; // currently-on tags derived from human events
  strong: string[]; // both layers agree the tag is on (合意)
  weak: string[]; // exactly one layer weighs in
  disputed: string[]; // layers disagree (one add, one remove)
}

/**
 * Aggregate the append-only tag_event stream for one target into the two derived
 * layers + strong/weak/disputed consensus (OBS-63). Deterministic: pure function
 * of Truth. Returns null when a derived layer has ZERO events — the 400 fires here
 * at aggregate read, never per append (批評家#4).
 */
export async function aggregateTags(
  s: TruthStore,
  targetType: string,
  targetId: string,
): Promise<TagAggregate | null> {
  const rows = (await s.listEvents(`truth/${TAG_TYPE}/${targetType}-${targetId}-`))
    .map(dataOf)
    .filter((d) => d.target_type === targetType && d.target_id === targetId);

  // latest action per (layer, tag) — created_at asc, tag_event_id tie-break.
  const sorted = rows.slice().sort((a, b) =>
    String(a.created_at).localeCompare(String(b.created_at)) ||
    String(a.tag_event_id).localeCompare(String(b.tag_event_id)),
  );
  const layerEvents = { ai: 0, user: 0 };
  const state: Record<"ai" | "user", Map<string, boolean>> = { ai: new Map(), user: new Map() };
  for (const d of sorted) {
    const layer = tagLayer(d.source_type);
    layerEvents[layer]++;
    const tag = String(d.tag ?? "");
    if (!tag) continue;
    state[layer].set(tag, d.action !== "remove"); // add/anything-but-remove = on
  }

  // both derived layers must carry at least one event (批評家#4 400 condition).
  if (layerEvents.ai === 0 || layerEvents.user === 0) return null;

  const strong: string[] = [];
  const weak: string[] = [];
  const disputed: string[] = [];
  const allTags = new Set([...state.ai.keys(), ...state.user.keys()]);
  for (const tag of allTags) {
    const aiHas = state.ai.has(tag);
    const userHas = state.user.has(tag);
    const aiOn = state.ai.get(tag) === true;
    const userOn = state.user.get(tag) === true;
    if (aiOn && userOn) strong.push(tag);
    else if (aiHas && userHas && aiOn !== userOn) disputed.push(tag);
    else if (aiOn || userOn) weak.push(tag);
  }
  const onTags = (m: Map<string, boolean>) => [...m.entries()].filter(([, on]) => on).map(([t]) => t).sort();
  return {
    target_type: targetType,
    target_id: targetId,
    ai_tags: onTags(state.ai),
    user_tags: onTags(state.user),
    strong: strong.sort(),
    weak: weak.sort(),
    disputed: disputed.sort(),
  };
}

/**
 * Append one tag_event with server-supplied defaults (tag_event_id/created_at/
 * schema_version/action) filled in — the shared write path for both the POST
 * /tags route body and internal auto-tagging callers (OBS-07 remeasure).
 */
export async function appendTagEvent(
  s: TruthStore,
  actorId: string,
  data: { target_type: string; target_id: string; tag: string; tag_type: string; source_type: string; action?: string; [k: string]: unknown },
): Promise<{ tag_event_id: string }> {
  const full: Record<string, unknown> = {
    tag_event_id: ulid(),
    action: "add",
    created_at: new Date().toISOString(),
    schema_version: 1,
    ...data,
  };
  const key = `truth/${TAG_TYPE}/${String(full.target_type)}-${String(full.target_id)}-${ulid()}.json`;
  await s.putEventAt(key, envelope(actorId, full));
  return { tag_event_id: String(full.tag_event_id) };
}

/**
 * OBS-07: auto-append the "再測定タグ"(remeasure tag)whenever a capture is
 * reanalyzed — テンプレ/AI/技術向上後の再測定には必ずこのタグを付与しデータ信頼性を
 * 担保する。best-effort: a tag-append failure must never block the reanalysis
 * result itself (the analysis event is the OBS-48 source of truth).
 */
export async function tagRemeasured(s: TruthStore, actorId: string, captureId: string): Promise<void> {
  try {
    await appendTagEvent(s, actorId, {
      target_type: "capture",
      target_id: captureId,
      tag: "remeasure",
      tag_type: "quality",
      source_type: "machine_suggested",
    });
  } catch {
    // best-effort — see docstring.
  }
}

// ── routes ─────────────────────────────────────────────────────────────────────

// POST /tags — append one tag_event (OBS-07/52/63). Single-layer append; the
// two-layer consensus is derived on read. Missing required fields (source_type,
// tag, …) fail frozen-schema validation → 400.
tagRoutes.post("/tags", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");
  const data: Record<string, unknown> = {
    tag_event_id: typeof body.tag_event_id === "string" && body.tag_event_id ? body.tag_event_id : ulid(),
    target_type: body.target_type,
    target_id: body.target_id,
    tag: body.tag,
    tag_type: body.tag_type,
    action: body.action ?? "add",
    source_type: body.source_type,
    created_at: typeof body.created_at === "string" ? body.created_at : new Date().toISOString(),
    schema_version: 1,
  };
  for (const k of ["source_id", "confidence", "reason", "evidence_ref", "model_name", "model_version", "run_id"] as const) {
    if (body[k] !== undefined) data[k] = body[k];
  }
  const key = `truth/${TAG_TYPE}/${String(data.target_type)}-${String(data.target_id)}-${ulid()}.json`;
  const res = await store(c).putEventAt(key, envelope(actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_TAG", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_TAG", key: res.key }, 409);
  return c.json({ tag_event_id: data.tag_event_id, layer: tagLayer(data.source_type) }, 201);
});

// GET /tags?target_type=&target_id= — derived two-layer aggregate (OBS-63).
// 400 when a target has zero events in one derived layer (批評家#4).
tagRoutes.get("/tags", async (c) => {
  const targetType = c.req.query("target_type");
  const targetId = c.req.query("target_id");
  if (!targetType || !targetId) return c.json({ error: "TARGET_REQUIRED" }, 400);
  const agg = await aggregateTags(store(c), targetType, targetId);
  if (!agg) return c.json({ error: "TAG_LAYER_INCOMPLETE" }, 400);
  return c.json(agg);
});
