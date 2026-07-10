// Observation core API (design-c2 §3.2). All routes PROTECTED — the auth
// middleware (index.ts §1.5) gates them and sets actorId. Every write stamps
// data.actor_id from the session principal (V3-AUT-17): a client-supplied
// actor_id in the body is ignored, never trusted.
import { Hono } from "hono";
import { TruthStore, ulid, cosineSimilarity } from "@ihl/truth";
import type { Bindings, Variables } from "./env";

export const obsRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// CL-08 / design-c3 §1: embeddings are frozen at 384 dims. A manifest whose
// embedding_dim differs is blocked from search (ver2 scoring.py:44 guard).
const EMBEDDING_DIM = 384;

const CAPTURE_TYPE = "ihl.obs.capture.v1";
const PHOTO_TYPE = "ihl.obs.photo.v1";
const TEMPLATE_TYPE = "ihl.obs.template.v1";
const QR_TYPE = "ihl.ind.qr.v1";

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}

function envelope(
  type: string,
  id: string,
  dataschema: string,
  actorId: string,
  data: Record<string, unknown>,
) {
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type,
    time: new Date().toISOString(),
    dataschema,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let hex = "";
  for (const b of digest) hex += b.toString(16).padStart(2, "0");
  return hex;
}

// data() of a stored envelope (projections return the data part only).
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

// Load one capture's embedding vector via its frozen manifest + embeddings.bin
// (design-c3 §1 "R2 読取投影"). Layout: embeddings/manifest/<capture_id>.json →
// { embedding_dim, embedding_file, vector_offset }; the raw float32 vector lives
// at vector_offset in the embeddings.bin blob. Returns null if no embedding
// exists or the bytes are out of range. The dim guard (≠384 → block) is applied
// by the caller against EMBEDDING_DIM (ver2 scoring.py:44 / CL-08).
async function loadVector(
  bucket: Bindings["TRUTH"],
  captureId: string,
): Promise<Float32Array | null> {
  const mObj = await bucket.get(`embeddings/manifest/${captureId}.json`);
  if (!mObj) return null;
  const m = JSON.parse(await mObj.text()) as {
    embedding_dim?: number;
    embedding_file?: string;
    vector_offset?: number;
  };
  const dim = m.embedding_dim ?? 0;
  if (!dim || !m.embedding_file) return null;
  const binObj = await bucket.get(m.embedding_file);
  if (!binObj) return null;
  const buf = await binObj.arrayBuffer();
  const offset = m.vector_offset ?? 0;
  if (offset < 0 || offset % 4 !== 0 || offset + dim * 4 > buf.byteLength) return null;
  return new Float32Array(buf.slice(offset, offset + dim * 4));
}

// A measurement's numeric value, or null if not numeric/absent.
function measureValue(cap: Record<string, unknown>, item: string): number | null {
  const ms = Array.isArray(cap.measurements) ? cap.measurements : [];
  for (const m of ms as Record<string, unknown>[]) {
    if (m.item === item && typeof m.value === "number") return m.value;
  }
  return null;
}

const CAPTURE_FIELDS = [
  "domain",
  "subject_ref",
  "sire_id",
  "dam_id",
  "species_candidate",
  "species_confirmed_by",
  "measurements",
  "template_id",
  "note",
] as const;

// POST /observation/captures — append a capture event (202/400/409).
// capture_id: client MAY supply a ULID (idempotency key → 409 on replay);
// else generated. actor_id is ALWAYS the session principal (V3-AUT-17).
obsRoutes.post("/observation/captures", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ error: "INVALID_BODY" }, 400);
  const actorId = c.get("actorId");
  const captureId = typeof body.capture_id === "string" && body.capture_id ? body.capture_id : ulid();

  const data: Record<string, unknown> = { capture_id: captureId, actor_id: actorId };
  for (const k of CAPTURE_FIELDS) if (body[k] !== undefined) data[k] = body[k];

  const res = await store(c).putEvent(
    envelope(CAPTURE_TYPE, captureId, "schemas/events/obs-capture.schema.json", actorId, data),
  );
  if (res.status === "invalid") return c.json({ error: "INVALID_CAPTURE", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_CAPTURE", key: res.key }, 409);
  return c.json({ capture_id: captureId }, 202);
});

// POST /observation/upload — multipart(file + capture_id) → sha256 → putBlob
// media/photo/<photo_id> → photo event. Photo event keyed under a
// capture-prefixed Truth key so the detail view lists by prefix.
obsRoutes.post("/observation/upload", async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  const captureId = form?.get("capture_id");
  if (!(file instanceof Blob) || typeof captureId !== "string" || !captureId) {
    return c.json({ error: "INVALID_UPLOAD" }, 400);
  }
  const actorId = c.get("actorId");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = file.type || "application/octet-stream";
  const photoId = ulid();
  const mediaKey = `media/photo/${photoId}`;

  await store(c).putBlob(mediaKey, bytes, contentType);

  const data = {
    photo_id: photoId,
    capture_id: captureId,
    actor_id: actorId,
    media_key: mediaKey,
    content_type: contentType,
    size_bytes: bytes.length,
    sha256: await sha256Hex(bytes),
  };
  // Truth key = truth/ihl.obs.photo.v1/<capture_id>-<photo_ulid>.json —
  // capture-prefix enables the detail-view list (design-c2 §3.1). envelope.id
  // stays a plain ULID (the CloudEvents id must match the envelope schema).
  const key = `truth/${PHOTO_TYPE}/${captureId}-${photoId}.json`;
  const res = await store(c).putEventAt(
    key,
    envelope(PHOTO_TYPE, photoId, "schemas/events/obs-photo.schema.json", actorId, data),
  );
  if (res.status === "invalid") return c.json({ error: "INVALID_PHOTO", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_PHOTO", key: res.key }, 409);
  return c.json({ photo_id: photoId, sha256: data.sha256 }, 202);
});

// GET /observation/templates — list projection (all templates).
obsRoutes.get("/observation/templates", async (c) => {
  const templates = (await store(c).listEvents(`truth/${TEMPLATE_TYPE}/`)).map(dataOf);
  return c.json({ templates });
});

// POST /observation/templates — append a template (V3-OBS-18 fork via forked_from).
obsRoutes.post("/observation/templates", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ error: "INVALID_BODY" }, 400);
  const actorId = c.get("actorId");
  const templateId = ulid();
  const data: Record<string, unknown> = {
    template_id: templateId,
    actor_id: actorId,
    title: body.title,
    items: body.items,
  };
  if (body.forked_from !== undefined) data.forked_from = body.forked_from;

  const res = await store(c).putEvent(
    envelope(TEMPLATE_TYPE, templateId, "schemas/events/obs-template.schema.json", actorId, data),
  );
  if (res.status === "invalid") return c.json({ error: "INVALID_TEMPLATE", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_TEMPLATE", key: res.key }, 409);
  return c.json({ template_id: templateId }, 202);
});

// POST /observation/search — deterministic similarity ladder (V3-OBS-10 / CL-08,
// design-c3 §1). ① whitelist (exact-match filter) → ② subset (measurement range
// filter) → ③ embedding (384-dim cosine rank via frozen cosineSimilarity).
// ladder_stage reports the deepest rung engaged. No resident index / FAISS / LLM
// (invariant clause ①). Deterministic: candidates sorted by capture_id, cosine
// ties broken by capture_id asc → same input ⇒ same ranking.
obsRoutes.post("/observation/search", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ error: "INVALID_BODY" }, 400);

  const topK = typeof body.top_k === "number" && body.top_k >= 1 ? Math.min(100, Math.floor(body.top_k)) : 10;

  // ponytail: full capture-type prefix scan, O(n) per query — no resident index
  // (design-c3 §1 "R2 list→都度計算"). A projection index is a later rung if n grows.
  let candidates = (await store(c).listEvents(`truth/${CAPTURE_TYPE}/`)).map(dataOf);
  candidates.sort((a, b) => String(a.capture_id).localeCompare(String(b.capture_id)));

  // ① whitelist — exact-match filters (only those the request supplied).
  if (typeof body.domain === "string") candidates = candidates.filter((x) => x.domain === body.domain);
  if (typeof body.species === "string") candidates = candidates.filter((x) => x.species_candidate === body.species);
  if (typeof body.subject_ref === "string") candidates = candidates.filter((x) => x.subject_ref === body.subject_ref);
  let stage = "whitelist";

  // ② subset — deterministic measurement range filter.
  const ranges = Array.isArray(body.measurements) ? (body.measurements as Record<string, unknown>[]) : [];
  if (ranges.length) {
    stage = "subset";
    candidates = candidates.filter((x) =>
      ranges.every((r) => {
        const v = measureValue(x, String(r.item));
        if (v === null) return false;
        if (typeof r.min === "number" && v < r.min) return false;
        if (typeof r.max === "number" && v > r.max) return false;
        return true;
      }),
    );
  }

  // ③ embedding — cosine rank against a 384-dim query vector.
  let queryVec: Float32Array | null = null;
  if (Array.isArray(body.query_vector)) {
    queryVec = Float32Array.from(body.query_vector as number[]);
  } else if (typeof body.query_capture_id === "string") {
    queryVec = await loadVector(c.env.TRUTH, body.query_capture_id);
    if (!queryVec) return c.json({ error: "QUERY_EMBEDDING_NOT_FOUND" }, 400);
  }

  if (queryVec) {
    if (queryVec.length !== EMBEDDING_DIM) return c.json({ error: "QUERY_DIM_MISMATCH", dim: queryVec.length }, 400);
    stage = "embedding";
    const scored: { capture_id: string; score: number }[] = [];
    for (const cap of candidates) {
      const capId = String(cap.capture_id);
      const vec = await loadVector(c.env.TRUTH, capId);
      if (!vec) continue; // no embedding for this capture
      if (vec.length !== EMBEDDING_DIM) continue; // 遮断: manifest embedding_dim ≠ 384 (CL-08)
      scored.push({ capture_id: capId, score: cosineSimilarity(queryVec, vec) });
    }
    scored.sort((a, b) => b.score - a.score || a.capture_id.localeCompare(b.capture_id));
    return c.json({ ladder_stage: stage, results: scored.slice(0, topK) });
  }

  return c.json({
    ladder_stage: stage,
    results: candidates.slice(0, topK).map((x) => ({ capture_id: String(x.capture_id) })),
  });
});

// GET /observation/{capture_id} — detail projection: capture + photos[].
obsRoutes.get("/observation/:capture_id", async (c) => {
  const captureId = c.req.param("capture_id");
  const capture = await store(c).readEvent(`truth/${CAPTURE_TYPE}/${captureId}.json`);
  if (!capture) return c.json({ error: "NOT_FOUND" }, 404);
  // capture-prefixed photo keys → prefix list, no full-type scan.
  const photos = (await store(c).listEvents(`truth/${PHOTO_TYPE}/${captureId}-`)).map(dataOf);
  const cap = dataOf(capture);
  // Surface the bare individual id (subject_ref = "individual/<id>") so the UI
  // can link to /individuals/<id> without carrying the prefix through the query.
  const subjectRef = typeof cap.subject_ref === "string" ? cap.subject_ref : "";
  const individual_id = subjectRef.startsWith("individual/")
    ? subjectRef.slice("individual/".length)
    : undefined;
  return c.json({ capture: cap, photos, individual_id });
});

// GET /observation/{capture_id}/image/{photo_id} — media blob.
obsRoutes.get("/observation/:capture_id/image/:photo_id", async (c) => {
  const photoId = c.req.param("photo_id");
  const obj = await c.env.TRUTH.get(`media/photo/${photoId}`);
  if (!obj) return c.json({ error: "NOT_FOUND" }, 404);
  return new Response(await obj.arrayBuffer(), {
    headers: { "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream" },
  });
});

// GET /individuals/{individual_id}/observations — captures pointing at this
// individual. ponytail: full capture-type scan + subject_ref filter, O(n);
// per-individual index is C3+ (design-c2 §3.1).
obsRoutes.get("/individuals/:individual_id/observations", async (c) => {
  const individualId = c.req.param("individual_id");
  const ref = `individual/${individualId}`;
  const observations = (await store(c).listEvents(`truth/${CAPTURE_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.subject_ref === ref);
  return c.json({ individual_id: individualId, observations });
});

// POST /individuals/{individual_id}/qr — issue an ind.qr.v1 token.
// token = 32 random bytes → base64url (43 chars). Keyed by token for O(1) resolve.
obsRoutes.post("/individuals/:individual_id/qr", async (c) => {
  const individualId = c.req.param("individual_id");
  const actorId = c.get("actorId");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));

  const data: Record<string, unknown> = {
    token,
    individual_id: individualId,
    actor_id: actorId,
    created_at: new Date().toISOString(),
  };
  if (typeof body.expires_at === "string") data.expires_at = body.expires_at;

  const res = await store(c).putEventAt(
    `truth/${QR_TYPE}/${token}.json`,
    envelope(QR_TYPE, ulid(), "schemas/events/ind-qr.schema.json", actorId, data),
  );
  if (res.status === "invalid") return c.json({ error: "INVALID_QR", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_QR", key: res.key }, 409);
  return c.json({ token, individual_id: individualId, expires_at: data.expires_at ?? null }, 202);
});

// GET /qr/{token} — resolve token → { individual_id } (observation re-entry).
obsRoutes.get("/qr/:token", async (c) => {
  const token = c.req.param("token");
  const ev = await store(c).readEvent(`truth/${QR_TYPE}/${token}.json`);
  if (!ev) return c.json({ error: "NOT_FOUND" }, 404);
  const d = dataOf(ev);
  if (typeof d.expires_at === "string" && Date.parse(d.expires_at) < Date.now()) {
    return c.json({ error: "QR_EXPIRED" }, 410);
  }
  return c.json({ individual_id: d.individual_id });
});
