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
import { DEVICE_TYPE } from "./device-routes";

export const sourceRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const PLACEMENT_TYPE = "ihl.src.placement.v1";
const BINDING_TYPE = "ihl.src.device_binding.v1";
const OCCUPANCY_TYPE = "ihl.src.occupancy.v1";
const TELEMETRY_TYPE = "ihl.src.telemetry.v1";
// V3-OBS-20 棚/場所 QR (CL-10 env_qr_token_v1・schemas/frozen/qr-token.schema.json
// と同型・別 truth type なので個体 QR ihl.ind.qr.v1 とは token 空間が分かれる).
export const ENV_QR_TYPE = "ihl.env.qr.v1";

const PLACEMENT_SCHEMA = "schemas/events/placement.schema.json";
const BINDING_SCHEMA = "schemas/events/device-binding.schema.json";
const OCCUPANCY_SCHEMA = "schemas/events/occupancy.schema.json";
const TELEMETRY_SCHEMA = "schemas/events/telemetry-ingest.schema.json";
const ENV_QR_SCHEMA = "schemas/frozen/qr-token.schema.json";
// V3-OBS-72 研究室環境コンテキスト(placement 基盤の拡張)。
const LAB_ENV_TYPE = "ihl.src.lab_environment.v1";
const LAB_ENV_SCHEMA = "schemas/events/lab-environment.schema.json";

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
function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
 * Takes a TruthStore (not a raw bucket) so callers that already hold one
 * (e.g. individual-routes.ts projectEnvironment, V3-IND-13) can reuse it
 * without re-instantiating — this is the SAME open/closed semantics as the
 * device-binding 409 check, exported so it isn't re-derived elsewhere.
 */
export async function projectOpenBindings(st: TruthStore, deviceId: string): Promise<string[]> {
  const events = await st.listEvents(`truth/${BINDING_TYPE}/`);
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
  const open = await projectOpenBindings(store(c), deviceId);
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
 * Occupant currently AT a placement — the placement-QR twin of
 * projectOpenOccupancy (that one keys by subject, this one by placement). Used
 * to resolve a scanned shelf/location QR to "whichever individual lives here
 * right now" (V3-OBS-20 棚→個体 連鎖). Same open-interval reasoning: a
 * phase:"start" record with no matching phase:"end" for the same occupancy_id.
 */
export async function projectOccupantAt(
  bucket: R2BucketLite,
  placementId: string,
): Promise<{ occupancy_id: string; subject_ref: string } | null> {
  const events = (await new TruthStore(bucket).listEvents(`truth/${OCCUPANCY_TYPE}/`)).map(dataOf);
  const started = new Map<string, string>(); // occupancy_id -> subject_ref
  const ended = new Set<string>();
  for (const d of events) {
    if (d.placement_id !== placementId) continue;
    if (d.phase === "start") started.set(String(d.occupancy_id), String(d.subject_ref));
    else if (d.phase === "end") ended.add(String(d.occupancy_id));
  }
  for (const [id, subjectRef] of started) {
    if (!ended.has(id)) return { occupancy_id: id, subject_ref: subjectRef };
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

// ── OBS-17: DeviceBinding/Occupancy auto-derivation at observation commit ───────

export interface DerivedDeviceBinding {
  device_id: string;
  binding_id: string | null;
  binding_opened: boolean;
  occupancy_id: string | null;
  occupancy_opened: boolean;
}

/**
 * OBS-17: observation commit時にdevices[]を宣言すると、専用binding APIを別途
 * 呼ばずにDeviceBinding/Occupancyの区間を自動派生する(commit1回で完結)。
 *
 * best-effort per device — 未登録デバイス/placement_ref未設定は自動派生できない
 * ので何もせず飛ばす(observationの成立自体をブロックしない)。既に open な
 * binding/occupancy があれば再利用し新規INSERTしない(環境の二重POST防止 —
 * projectOpenBindings/projectOpenOccupancyのGLOBAL open判定をそのまま使う)。
 */
export async function deriveDeviceBindingsForCapture(
  bucket: R2BucketLite,
  actorId: string,
  subjectRef: string,
  deviceIds: string[],
): Promise<DerivedDeviceBinding[]> {
  const s = new TruthStore(bucket);
  const out: DerivedDeviceBinding[] = [];
  for (const deviceId of deviceIds) {
    const deviceRec = await s.readEvent(`truth/${DEVICE_TYPE}/${deviceId}.json`);
    const placementId = deviceRec ? (dataOf(deviceRec).placement_ref as string | undefined) : undefined;
    if (!placementId) {
      out.push({ device_id: deviceId, binding_id: null, binding_opened: false, occupancy_id: null, occupancy_opened: false });
      continue;
    }

    // binding: reuse the already-open one for this device (device-GLOBAL, same
    // rule as POST /device-bindings), else open a new one.
    const openBindingIds = await projectOpenBindings(s, deviceId);
    let bindingId = openBindingIds[0] ?? null;
    let bindingOpened = false;
    if (!bindingId) {
      bindingId = ulid();
      const data: Record<string, unknown> = {
        binding_id: bindingId,
        actor_id: actorId,
        device_id: deviceId,
        placement_id: placementId,
        phase: "start",
        effective_at: new Date().toISOString(),
        schema_version: BINDING_TYPE,
      };
      if (subjectRef) data.subject_ref = subjectRef;
      const res = await s.putEventAt(`truth/${BINDING_TYPE}/${bindingId}-start.json`, envelope(BINDING_TYPE, BINDING_SCHEMA, actorId, data));
      bindingOpened = res.status === "inserted";
    }

    // occupancy: only if the capture names a subject and it has no open
    // occupancy yet (a subject already elsewhere is a "move", not this route's
    // concern — batch-commit kind:"move" / moveOccupancy handles that).
    let occupancyId: string | null = null;
    let occupancyOpened = false;
    if (subjectRef) {
      const open = await projectOpenOccupancy(bucket, subjectRef);
      if (open) {
        occupancyId = open.occupancy_id;
      } else {
        occupancyId = ulid();
        const data = {
          occupancy_id: occupancyId,
          actor_id: actorId,
          placement_id: placementId,
          subject_ref: subjectRef,
          phase: "start",
          effective_at: new Date().toISOString(),
          schema_version: OCCUPANCY_TYPE,
        };
        const res = await s.putEventAt(`truth/${OCCUPANCY_TYPE}/${occupancyId}-start.json`, envelope(OCCUPANCY_TYPE, OCCUPANCY_SCHEMA, actorId, data));
        occupancyOpened = res.status === "inserted";
      }
    }

    out.push({ device_id: deviceId, binding_id: bindingId, binding_opened: bindingOpened, occupancy_id: occupancyId, occupancy_opened: occupancyOpened });
  }
  return out;
}

// ── placement QR (V3-OBS-20 棚/場所からQR発行) ──────────────────────────────

// POST /placements/{placement_id}/qr — issue an env_qr_token_v1 QR (CL-10
// frozen shape). Scanning it (GET /qr/:token, observation-routes.ts) resolves
// to whichever individual currently occupies this placement (projectOccupantAt)
// and chains the SAME "last observation" prefill an individual QR gets —
// 棚→個体→種→前回テンプレ (design-c2 §3.2 / OBS-20). dataschema points at the
// frozen schema, so putEventAt's envelope validation enforces the CL-10 shape
// on write (same contract cl-10-qr-token.test.ts checks statically).
sourceRoutes.post("/placements/:placement_id/qr", async (c) => {
  const placementId = c.req.param("placement_id");
  const actorId = c.get("actorId");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const token = b64url(crypto.getRandomValues(new Uint8Array(24)));
  const createdAt = new Date().toISOString();
  const expiresAt =
    typeof body.expires_at === "string" ? body.expires_at : new Date(Date.now() + 3600_000).toISOString();
  const data = {
    schema: "env_qr_token_v1",
    token,
    placement_id: placementId,
    actor_id: actorId,
    created_at: createdAt,
    expires_at: expiresAt,
  };
  const res = await store(c).putEventAt(
    `truth/${ENV_QR_TYPE}/${token}.json`,
    envelope(ENV_QR_TYPE, ENV_QR_SCHEMA, actorId, data),
  );
  if (res.status === "invalid") return c.json({ error: "INVALID_QR", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_QR", key: res.key }, 409);
  return c.json({ token, placement_id: placementId, expires_at: expiresAt }, 201);
});

// ── lab environment (V3-OBS-72 研究室環境コンテキスト) ─────────────────────
// Extends the placement 基盤 (K7): the room/shelf layout and HVAC/sensor
// description a placement sits in, so an observation can point at "the most
// reliable Hercules-beetle husbandry data" (round-16 ruling round-13
// citation) — environment that EXPLAINS the reading, not just a bare number.
// Append-only history per placement_id; a read projects the latest record
// (same "recompute, no resident index" shape as projectTelemetryLatest).

/** Latest lab-environment description recorded for a placement, or null. */
export async function projectLabEnvironmentAt(
  bucket: R2BucketLite,
  placementId: string,
): Promise<{
  room_label: string;
  hvac_profile: string | null;
  sensor_position: string | null;
  created_at: string;
} | null> {
  const events = (await new TruthStore(bucket).listEvents(`truth/${LAB_ENV_TYPE}/`)).map(dataOf);
  let latest: Record<string, unknown> | null = null;
  for (const d of events) {
    if (d.placement_id !== placementId) continue;
    if (!latest || String(d.created_at) > String(latest.created_at)) latest = d;
  }
  if (!latest) return null;
  return {
    room_label: String(latest.room_label),
    hvac_profile: typeof latest.hvac_profile === "string" ? latest.hvac_profile : null,
    sensor_position: typeof latest.sensor_position === "string" ? latest.sensor_position : null,
    created_at: String(latest.created_at),
  };
}

// POST /placements/{placement_id}/lab-environment — append a room/HVAC/sensor
// description. room_label required; hvac_profile/sensor_position free-text/任意.
sourceRoutes.post("/placements/:placement_id/lab-environment", async (c) => {
  const placementId = c.req.param("placement_id");
  const actorId = c.get("actorId");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const roomLabel = str(body.room_label);
  if (!roomLabel) return c.json({ error: "INVALID_LAB_ENVIRONMENT", details: ["room_label required"] }, 400);
  const id = ulid();
  const data: Record<string, unknown> = {
    lab_environment_id: id,
    actor_id: actorId,
    placement_id: placementId,
    room_label: roomLabel,
    created_at: new Date().toISOString(),
    schema_version: LAB_ENV_TYPE,
  };
  const hvac = str(body.hvac_profile);
  if (hvac) data.hvac_profile = hvac;
  const sensor = str(body.sensor_position);
  if (sensor) data.sensor_position = sensor;
  const res = await store(c).putEventAt(
    `truth/${LAB_ENV_TYPE}/${id}.json`,
    envelope(LAB_ENV_TYPE, LAB_ENV_SCHEMA, actorId, data),
  );
  if (res.status === "invalid") return c.json({ error: "INVALID_LAB_ENVIRONMENT", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_LAB_ENVIRONMENT", key: res.key }, 409);
  return c.json({ lab_environment_id: id, placement_id: placementId }, 201);
});

// GET /placements/{placement_id}/lab-environment — latest description. A
// placement legitimately starts with none recorded yet (honest empty state,
// not 404 — V3-UIX-03).
sourceRoutes.get("/placements/:placement_id/lab-environment", async (c) => {
  const placementId = c.req.param("placement_id");
  const latest = await projectLabEnvironmentAt(c.env.TRUTH, placementId);
  return c.json({ placement_id: placementId, lab_environment: latest });
});

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
