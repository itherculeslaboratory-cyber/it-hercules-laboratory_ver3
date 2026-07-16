// FND-18 source ingest routes (design-k7 §1.1/§1.2). PROTECTED (deny-by-default:
// this module is NOT in index.ts PUBLIC_ROUTES — session gate applies). Four
// source concepts append to Truth via TruthStore put-if-absent (INSERT ONLY):
//   placement · device_binding (start/end phases) · occupancy · telemetry.
// The write actor_id is ALWAYS forced from the session principal (c.get("actorId")),
// never read from the request body — a client-forged actor_id is ignored (V3-AUT-17).
//
// NOTE: not wired into index.ts here — mounting is package 6. The fnd-18 TC mounts
// this exported module on its own Hono app with the in-memory R2 mock.
//
// The signed-value telemetry path (Ed25519 collector) is NOT re-implemented — that
// stays /collector/ingest (C3). This module ingests already-authenticated session
// telemetry as bucketized aggregates.
import { Hono } from "hono";
import { TruthStore, ulid, type R2BucketLite } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { bucketize, type TelemetryBucket } from "./telemetry-merge";

export const sourceRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const PLACEMENT_TYPE = "ihl.src.placement.v1";
const BINDING_TYPE = "ihl.src.device_binding.v1";
const OCCUPANCY_TYPE = "ihl.src.occupancy.v1";
const TELEMETRY_TYPE = "ihl.src.telemetry.v1";

const PLACEMENT_SCHEMA = "schemas/events/placement.schema.json";
const BINDING_SCHEMA = "schemas/events/device-binding.schema.json";
const OCCUPANCY_SCHEMA = "schemas/events/occupancy.schema.json";
const TELEMETRY_SCHEMA = "schemas/events/telemetry-ingest.schema.json";

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}
function envelope(type: string, dataschema: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id: ulid(),
    source: "apps/api",
    type,
    time: new Date().toISOString(),
    dataschema,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

// ── placements ──────────────────────────────────────────────────────────────

// POST /placements — register a placement. label required; placement_id minted
// server-side. actor_id forced from session.
sourceRoutes.post("/placements", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");
  const label = str(body.label);
  if (!label) return c.json({ error: "INVALID_PLACEMENT", details: ["label required"] }, 400);
  const placementId = ulid();
  const data = {
    placement_id: placementId,
    actor_id: actorId,
    label,
    created_at: new Date().toISOString(),
    schema_version: PLACEMENT_TYPE,
  };
  const res = await store(c).putEventAt(`truth/${PLACEMENT_TYPE}/${placementId}.json`, envelope(PLACEMENT_TYPE, PLACEMENT_SCHEMA, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_PLACEMENT", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_PLACEMENT", key: res.key }, 409);
  return c.json({ placement_id: placementId, label }, 201);
});

// GET /placements — 本人スコープ list projection (prefix scan, recompute each call).
sourceRoutes.get("/placements", async (c) => {
  const actorId = c.get("actorId");
  const rows = (await store(c).listEvents(`truth/${PLACEMENT_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.actor_id === actorId)
    .map((d) => ({ placement_id: d.placement_id, label: d.label, created_at: d.created_at }));
  return c.json({ placements: rows });
});

// ── device bindings ─────────────────────────────────────────────────────────

/**
 * Open binding_ids for a device: a start phase with no matching end phase.
 * Prefix scan of all binding events (open-check is device-GLOBAL, not actor-
 * scoped — a device can only be bound once at a time). ponytail: O(n) scan of
 * one event type, fine for MVP volumes (same ceiling as TruthStore.listEvents).
 */
export async function projectOpenBindings(bucket: R2BucketLite, deviceId: string): Promise<string[]> {
  const events = await new TruthStore(bucket).listEvents(`truth/${BINDING_TYPE}/`);
  const started = new Set<string>();
  const ended = new Set<string>();
  for (const e of events) {
    const d = dataOf(e);
    if (d.device_id !== deviceId) continue;
    if (d.phase === "start") started.add(d.binding_id as string);
    else if (d.phase === "end") ended.add(d.binding_id as string);
  }
  return [...started].filter((id) => !ended.has(id));
}

// POST /device-bindings — start a binding. 409 if the device already has an open
// binding (projectOpenBindings). start phase → NEW INSERT.
sourceRoutes.post("/device-bindings", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");
  const deviceId = str(body.device_id);
  const placementId = str(body.placement_id);
  if (!deviceId || !placementId) {
    return c.json({ error: "INVALID_BINDING", details: ["device_id and placement_id required"] }, 400);
  }
  const open = await projectOpenBindings(c.env.TRUTH, deviceId);
  if (open.length > 0) return c.json({ error: "DEVICE_ALREADY_BOUND", open_binding_id: open[0] }, 409);

  const bindingId = ulid();
  const data: Record<string, unknown> = {
    binding_id: bindingId,
    actor_id: actorId,
    device_id: deviceId,
    placement_id: placementId,
    phase: "start",
    effective_at: new Date().toISOString(),
    schema_version: BINDING_TYPE,
  };
  const subjectRef = str(body.subject_ref);
  if (subjectRef) data.subject_ref = subjectRef;
  const res = await store(c).putEventAt(`truth/${BINDING_TYPE}/${bindingId}-start.json`, envelope(BINDING_TYPE, BINDING_SCHEMA, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_BINDING", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_BINDING", key: res.key }, 409);
  return c.json({ binding_id: bindingId, phase: "start" }, 201);
});

// POST /device-bindings/end — end a binding. end phase = a NEW INSERT (the start
// event is NEVER updated). Copies device_id/placement_id from the start event.
// 404 if no start for this binding (or not owned by the caller); 409 if already
// ended (put-if-absent on the -end key).
sourceRoutes.post("/device-bindings/end", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");
  const bindingId = str(body.binding_id);
  if (!bindingId) return c.json({ error: "INVALID_BINDING", details: ["binding_id required"] }, 400);

  const start = await store(c).readEvent(`truth/${BINDING_TYPE}/${bindingId}-start.json`);
  if (!start) return c.json({ error: "NOT_FOUND" }, 404);
  const sd = dataOf(start);
  if (sd.actor_id !== actorId) return c.json({ error: "NOT_FOUND" }, 404); // 本人スコープ

  const data: Record<string, unknown> = {
    binding_id: bindingId,
    actor_id: actorId,
    device_id: sd.device_id,
    placement_id: sd.placement_id,
    phase: "end",
    effective_at: new Date().toISOString(),
    schema_version: BINDING_TYPE,
  };
  if (typeof sd.subject_ref === "string") data.subject_ref = sd.subject_ref;
  const res = await store(c).putEventAt(`truth/${BINDING_TYPE}/${bindingId}-end.json`, envelope(BINDING_TYPE, BINDING_SCHEMA, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_BINDING", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "ALREADY_ENDED", key: res.key }, 409);
  return c.json({ binding_id: bindingId, phase: "end" }, 201);
});

// GET /device-bindings — 本人スコープ list projection with derived open/closed state.
sourceRoutes.get("/device-bindings", async (c) => {
  const actorId = c.get("actorId");
  const events = (await store(c).listEvents(`truth/${BINDING_TYPE}/`)).map(dataOf).filter((d) => d.actor_id === actorId);
  const ended = new Set(events.filter((d) => d.phase === "end").map((d) => d.binding_id));
  const rows = events
    .filter((d) => d.phase === "start")
    .map((d) => ({
      binding_id: d.binding_id,
      device_id: d.device_id,
      placement_id: d.placement_id,
      open: !ended.has(d.binding_id),
    }));
  return c.json({ bindings: rows });
});

// ── occupancy ───────────────────────────────────────────────────────────────

// POST /occupancy — register an occupancy record. placement_id + subject_ref
// required. actor_id forced from session.
sourceRoutes.post("/occupancy", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");
  const placementId = str(body.placement_id);
  const subjectRef = str(body.subject_ref);
  if (!placementId || !subjectRef) {
    return c.json({ error: "INVALID_OCCUPANCY", details: ["placement_id and subject_ref required"] }, 400);
  }
  const occupancyId = ulid();
  const data = {
    occupancy_id: occupancyId,
    actor_id: actorId,
    placement_id: placementId,
    subject_ref: subjectRef,
    effective_at: new Date().toISOString(),
    schema_version: OCCUPANCY_TYPE,
  };
  const res = await store(c).putEventAt(`truth/${OCCUPANCY_TYPE}/${occupancyId}.json`, envelope(OCCUPANCY_TYPE, OCCUPANCY_SCHEMA, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_OCCUPANCY", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_OCCUPANCY", key: res.key }, 409);
  return c.json({ occupancy_id: occupancyId }, 201);
});

// GET /occupancy — 本人スコープ list projection.
sourceRoutes.get("/occupancy", async (c) => {
  const actorId = c.get("actorId");
  const rows = (await store(c).listEvents(`truth/${OCCUPANCY_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.actor_id === actorId)
    .map((d) => ({
      occupancy_id: d.occupancy_id,
      placement_id: d.placement_id,
      subject_ref: d.subject_ref,
      effective_at: d.effective_at,
      phase: d.phase ?? null,
    }));
  return c.json({ occupancy: rows });
});

/**
 * Open occupancy for a subject_ref: a phase:"start" record with no matching
 * phase:"end" for the same occupancy_id (same reasoning as
 * projectOpenBindings — a subject occupies at most one placement at a time).
 * Legacy phase-less single-shot records are not "open" intervals — only
 * start/end-tagged records participate (V3-AIP-101 F4 移動).
 */
export async function projectOpenOccupancy(
  bucket: R2BucketLite,
  subjectRef: string,
): Promise<{ occupancy_id: string; placement_id: string } | null> {
  const events = (await new TruthStore(bucket).listEvents(`truth/${OCCUPANCY_TYPE}/`)).map(dataOf);
  const started = new Map<string, string>(); // occupancy_id -> placement_id
  const ended = new Set<string>();
  for (const d of events) {
    if (d.subject_ref !== subjectRef) continue;
    if (d.phase === "start") started.set(String(d.occupancy_id), String(d.placement_id));
    else if (d.phase === "end") ended.add(String(d.occupancy_id));
  }
  for (const [id, placementId] of started) {
    if (!ended.has(id)) return { occupancy_id: id, placement_id: placementId };
  }
  return null;
}

/**
 * Move a subject to a new placement: end the currently-open occupancy (if
 * any) + start a new one, as ONE logical action (F4 wireframe「移動」/
 * batch-commit kind:"move" — device-binding start/end と同型の2相append).
 */
export async function moveOccupancy(
  bucket: R2BucketLite,
  actorId: string,
  subjectRef: string,
  toPlacementId: string,
  at: string,
): Promise<{ occupancy_id: string; ended_previous: boolean }> {
  const s = new TruthStore(bucket);
  const open = await projectOpenOccupancy(bucket, subjectRef);
  let endedPrevious = false;
  if (open) {
    const endData = {
      occupancy_id: open.occupancy_id,
      actor_id: actorId,
      placement_id: open.placement_id,
      subject_ref: subjectRef,
      phase: "end",
      effective_at: at,
      schema_version: OCCUPANCY_TYPE,
    };
    const endRes = await s.putEventAt(
      `truth/${OCCUPANCY_TYPE}/${open.occupancy_id}-end.json`,
      envelope(OCCUPANCY_TYPE, OCCUPANCY_SCHEMA, actorId, endData),
    );
    endedPrevious = endRes.status === "inserted";
  }
  const newId = ulid();
  const startData = {
    occupancy_id: newId,
    actor_id: actorId,
    placement_id: toPlacementId,
    subject_ref: subjectRef,
    phase: "start",
    effective_at: at,
    schema_version: OCCUPANCY_TYPE,
  };
  await s.putEventAt(
    `truth/${OCCUPANCY_TYPE}/${newId}-start.json`,
    envelope(OCCUPANCY_TYPE, OCCUPANCY_SCHEMA, actorId, startData),
  );
  return { occupancy_id: newId, ended_previous: endedPrevious };
}

// ── telemetry ───────────────────────────────────────────────────────────────

// telemetry Truth key. ponytail: DEVIATION from design §1.2 literal key
// (<device_id>-<bucket_start_ms>) — metric is included so two metrics in the SAME
// 5-min bucket for one device don't collide (bucketize already groups by metric).
// Dropping metric would make the second metric a false skipped_duplicate and lose
// its reading permanently (Truth is INSERT ONLY). Upgrade path: none needed.
//
// V3-OBS-32 / OQ-LB-02: `source` (csv/collector/manual) is now ALSO part of the
// key. put-if-absent stays first-wins per KEY, but two different sources no
// longer collide on the SAME logical bucket (device_id, metric, bucket_start_ms)
// — both snapshots persist and read-back (projectTelemetryLatest below) picks
// the source-count-max one. Segments are encodeURIComponent'd (hyphens folded to
// %2D) so no raw "-" survives inside a segment — the "-" separators between
// segments stay unambiguous (same reasoning as the device_id/metric case above).
function telemetryKey(b: TelemetryBucket, source: string): string {
  const seg = (s: string) => encodeURIComponent(s).replace(/-/g, "%2D");
  return `truth/${TELEMETRY_TYPE}/${seg(b.device_id)}-${seg(b.metric)}-${b.bucket_start_ms}-${seg(source)}.json`;
}

/**
 * Shared bucketized-telemetry writer (V3-OBS-32 / V3-FND-18). Both the generic
 * POST /telemetry route (source="manual") and the CSV import route
 * (env-import-routes.ts, source="csv") funnel through this — one ingest path,
 * one key scheme, so read-back never has to reconcile two implementations.
 * dryRun=true performs the SAME put-if-absent existence check via readEvent
 * (no write) so a caller can preview would-be written/skipped_duplicate counts
 * without mutating Truth.
 */
export async function ingestTelemetryBuckets(
  st: TruthStore,
  actorId: string,
  buckets: TelemetryBucket[],
  source: string,
  opts: { dryRun?: boolean } = {},
): Promise<{ written: number; skipped_duplicate: number; invalid: string[] }> {
  let written = 0;
  let skippedDuplicate = 0;
  const invalid: string[] = [];
  for (const b of buckets) {
    const key = telemetryKey(b, source);
    if (opts.dryRun) {
      const existing = await st.readEvent(key);
      if (existing) skippedDuplicate += 1;
      else written += 1;
      continue;
    }
    const data = {
      device_id: b.device_id,
      bucket_start_ms: b.bucket_start_ms,
      metric: b.metric,
      mean: b.mean,
      count: b.count,
      source_granularity_ms: b.source_granularity_ms,
      source,
      schema_version: TELEMETRY_TYPE,
    };
    const res = await st.putEventAt(key, envelope(TELEMETRY_TYPE, TELEMETRY_SCHEMA, actorId, data));
    if (res.status === "inserted") written += 1;
    else if (res.status === "conflict") skippedDuplicate += 1;
    else invalid.push(...res.errors);
  }
  return { written, skipped_duplicate: skippedDuplicate, invalid };
}

export interface TelemetrySnapshot {
  metric: string;
  bucket_start_ms: number;
  mean: number;
  count: number;
  source_granularity_ms: number;
  source: string;
}

/**
 * Read-back projection (V3-OBS-32 / OQ-LB-02): a device may have MULTIPLE
 * snapshots for the same logical bucket (device_id, metric, bucket_start_ms) —
 * one per ingest source, since telemetryKey now includes source. This picks,
 * per logical bucket, the snapshot with the highest count (=source-count, the
 * number of raw rows aggregated into it); ties prefer source "csv" (環境の正本)
 * over other sources (usecase-driven-design §machines-environment-io 手順11).
 * Always recomputed from Truth (prefix scan) — no resident index (不変条項①).
 */
export async function projectTelemetryLatest(
  bucket: R2BucketLite,
  deviceId: string,
  metric?: string,
): Promise<TelemetrySnapshot[]> {
  const seg = (s: string) => encodeURIComponent(s).replace(/-/g, "%2D");
  const prefix = `truth/${TELEMETRY_TYPE}/${seg(deviceId)}-`;
  const events = (await new TruthStore(bucket).listEvents(prefix)).map(dataOf);
  const best = new Map<string, TelemetrySnapshot>(); // key: metric|bucket_start_ms
  for (const d of events) {
    if (typeof d.metric !== "string" || typeof d.bucket_start_ms !== "number") continue;
    if (metric && d.metric !== metric) continue;
    const snap: TelemetrySnapshot = {
      metric: d.metric,
      bucket_start_ms: d.bucket_start_ms,
      mean: Number(d.mean),
      count: Number(d.count),
      source_granularity_ms: Number(d.source_granularity_ms),
      source: typeof d.source === "string" ? d.source : "manual",
    };
    const key = `${snap.metric}|${snap.bucket_start_ms}`;
    const cur = best.get(key);
    const snapWins = !cur || snap.count > cur.count || (snap.count === cur.count && snap.source === "csv" && cur.source !== "csv");
    if (snapWins) best.set(key, snap);
  }
  return [...best.values()].sort((a, b) => a.metric.localeCompare(b.metric) || a.bucket_start_ms - b.bucket_start_ms);
}

// POST /telemetry — ingest raw 1-min rows, bucketize to 5-min aggregates, append
// each bucket idempotently. Merge outcome is storage-layer put-if-absent:
//   inserted → written · 409 → skipped_duplicate · invalid rows → skipped_invalid.
// actor_id (provenance) forced from session; device_id comes from the rows.
// source="manual" (this is the direct/session ingest path — distinct from the
// V3-OBS-32 CSV route and the Ed25519 collector path, see ingestTelemetryBuckets).
sourceRoutes.post("/telemetry", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const buckets = bucketize(rows);
  const validRowCount = buckets.reduce((n, b) => n + b.count, 0);

  const st = store(c);
  const { written, skipped_duplicate, invalid } = await ingestTelemetryBuckets(st, actorId, buckets, "manual");
  if (invalid.length > 0) return c.json({ error: "INVALID_TELEMETRY", details: invalid }, 400);
  return c.json({ written, skipped_duplicate, skipped_invalid: rows.length - validRowCount }, 202);
});
