// Observation core API (design-c2 §3.2). All routes PROTECTED — the auth
// middleware (index.ts §1.5) gates them and sets actorId. Every write stamps
// data.actor_id from the session principal (V3-AUT-17): a client-supplied
// actor_id in the body is ignored, never trusted.
import { Hono } from "hono";
import { TruthStore, ulid, cosineSimilarity } from "@ihl/truth";
import { generateThumbnail } from "./thumbnail";
import {
  RERANK_WEIGHTS,
  RERANK_MISSING,
  NAVIGATOR_TARGET_QUESTIONS,
  CONFIDENCE_ORDER,
} from "./observation-constants";
import type { Bindings, Variables } from "./env";

export const obsRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const ANNOTATION_TYPE = "ihl.obs.annotation.v1";
const ANALYSIS_TYPE = "ihl.obs.analysis.v1";

// The 9 frozen provenance value_origin values (CONFIDENCE_ORDER is keyed by
// exactly this enum — reuse it so the gate can never drift from the schema).
const VALUE_ORIGINS = new Set(Object.keys(CONFIDENCE_ORDER));

// CL-08 / design-c3 §1: embeddings are frozen at 384 dims. A manifest whose
// embedding_dim differs is blocked from search (ver2 scoring.py:44 guard).
const EMBEDDING_DIM = 384;

const CAPTURE_TYPE = "ihl.obs.capture.v1";
const PHOTO_TYPE = "ihl.obs.photo.v1";
const THUMBNAIL_TYPE = "ihl.obs.thumbnail.v1";
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
  provenance?: Record<string, unknown>,
) {
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type,
    time: new Date().toISOString(),
    dataschema,
    provenance: provenance ?? { generator_kind: "human", actor_id: actorId },
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
  "entry_mode",
  "subspecies_candidate",
  "subspecies_confirmed_by",
  "photo_conditions",
  "note",
] as const;

// ── OBS-11 rerank math (pure, deterministic; weights/defaults from constants) ──

/** compositeScore blend (OBS-11 / ADR-H-12): 0.50·e + 0.20·color + 0.20·size +
 *  0.10·lineage. Absent color/size default 0.5, absent lineage 0.0 (欠測既定). */
export function compositeScore(p: {
  embedding: number;
  color?: number;
  size?: number;
  lineage?: number;
}): number {
  const w = RERANK_WEIGHTS;
  return (
    w.embedding * p.embedding +
    w.color * (p.color ?? RERANK_MISSING.color) +
    w.size * (p.size ?? RERANK_MISSING.size) +
    w.lineage * (p.lineage ?? RERANK_MISSING.lineage)
  );
}

/** Collapse an individual's per-observation scores to one (OBS-11). scores are
 *  in chronological order (newest last) for weighted_latest. */
export function aggregateIndividual(
  scores: number[],
  method: "max" | "mean_top3" | "weighted_latest",
): number {
  if (scores.length === 0) return 0;
  if (method === "max") return Math.max(...scores);
  if (method === "mean_top3") {
    const top = [...scores].sort((a, b) => b - a).slice(0, 3);
    return top.reduce((s, x) => s + x, 0) / top.length;
  }
  // weighted_latest: later observation weighs more (weight = 1-based position).
  let num = 0;
  let den = 0;
  scores.forEach((s, i) => {
    num += (i + 1) * s;
    den += i + 1;
  });
  return num / den;
}

// ── OBS-02 target catalog + deterministic navigator (Wikidata-free slice) ──
// ponytail: a generated local classification tree (4 families × 8 genera × 8
// species = 256 leaves). Live Wikidata enrichment is a later wave (design §5
// 費用 defer); QIDs/taxonomy here are a deterministic local stand-in so the
// yes-no binary search converges in ceil(log2(256))=8 questions — inside the
// [7,12] bound (NAVIGATOR_TARGET_QUESTIONS) without hard-coding 256 rows.
const CATALOG_FAMILIES = 4;
const CATALOG_GENERA = 8;
const CATALOG_SPECIES = 8;
const CATALOG_SIZE = CATALOG_FAMILIES * CATALOG_GENERA * CATALOG_SPECIES; // 256

type CatalogLeaf = {
  qid: string;
  scientific_name: string;
  taxonomy: { family: string; genus: string; species: string };
};

function catalogLeaf(i: number): CatalogLeaf {
  const f = i >> 6; // 0..3
  const g = (i >> 3) & 7; // 0..7
  const s = i & 7; // 0..7
  const family = `Family${f}`;
  const genus = `Genus${f}${g}`;
  const scientific_name = `${genus} species${s}`;
  return { qid: `Q${9000000 + i}`, scientific_name, taxonomy: { family, genus, species: scientific_name } };
}

function catalogAll(): CatalogLeaf[] {
  return Array.from({ length: CATALOG_SIZE }, (_, i) => catalogLeaf(i));
}

// ── OBS-28 photo_conditions validation (spoof reject + threshold alert) ──
// ponytail: physical-plausibility bounds + placeholder sentinels are the
// calibration knobs; real sensor ingestion is a later wave.
const CONDITION_LIMITS = {
  temp_c: { min: -90, max: 60, alertHigh: 35, alertLow: 5 },
  humidity_pct: { min: 0, max: 100, alertHigh: 85, alertLow: 20 },
} as const;

function validatePhotoConditions(
  pc: Record<string, unknown>,
): { ok: true; normalized: Record<string, unknown>; alerts: string[] } | { ok: false; reason: string } {
  const out: Record<string, unknown> = {};
  const alerts: string[] = [];
  for (const key of ["temp_c", "humidity_pct"] as const) {
    if (pc[key] === undefined) continue;
    const v = pc[key];
    if (typeof v !== "number" || !Number.isFinite(v)) return { ok: false, reason: `${key}_not_number` };
    const lim = CONDITION_LIMITS[key];
    // 偽装拒否: a physically impossible reading is a spoofed placeholder.
    if (v < lim.min || v > lim.max) return { ok: false, reason: `${key}_placeholder` };
    if (v > lim.alertHigh) alerts.push(`${key}_high`);
    if (v < lim.alertLow) alerts.push(`${key}_low`);
    out[key] = v;
  }
  // captured_at: auto-fill now if absent; reject an epoch-0 placeholder.
  const at = pc.captured_at;
  if (at === undefined) {
    out.captured_at = new Date().toISOString();
  } else if (typeof at !== "string" || Number.isNaN(Date.parse(at)) || Date.parse(at) <= 0) {
    return { ok: false, reason: "captured_at_placeholder" };
  } else {
    out.captured_at = at;
  }
  return { ok: true, normalized: out, alerts };
}

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

  // OBS-28: photo_conditions captured at shot time. Multipart carries it as a
  // JSON string field. Auto-fill captured_at, reject spoofed placeholder values
  // (400), and surface a threshold alert. The normalized conditions ride the
  // response so the confirm/commit step embeds them on the capture record (the
  // obs-capture schema owns photo_conditions; the immutable photo event does not).
  let conditions: { normalized: Record<string, unknown>; alerts: string[] } | null = null;
  const pcRaw = form?.get("photo_conditions");
  if (typeof pcRaw === "string" && pcRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(pcRaw);
    } catch {
      return c.json({ error: "INVALID_PHOTO_CONDITIONS" }, 400);
    }
    if (typeof parsed !== "object" || parsed === null) {
      return c.json({ error: "INVALID_PHOTO_CONDITIONS" }, 400);
    }
    const v = validatePhotoConditions(parsed as Record<string, unknown>);
    if (!v.ok) return c.json({ error: "PHOTO_CONDITIONS_SPOOFED", reason: v.reason }, 400);
    conditions = { normalized: v.normalized, alerts: v.alerts };
  }

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

  // CL-07 thumbnail (第10回裁定 — JPEG / jSquash on Workers / 長辺512px / EXIF
  // transpose). BEST-EFFORT: a non-image or codec failure must NOT fail the
  // upload — the original blob + photo event are the append-only truth. The
  // thumbnail is a re-generatable derived artifact keyed under its own type so it
  // never leaks into the photos[] projection.
  try {
    const thumb = await generateThumbnail(bytes, contentType);
    const thumbKey = `media/thumbnail/${photoId}`;
    await store(c).putBlob(thumbKey, thumb.bytes, "image/jpeg");
    // individual_id is required by the frozen manifest; derive it from the
    // capture's subject_ref ("individual/<id>"), "" if the capture has none.
    const cap = await store(c).readEvent(`truth/${CAPTURE_TYPE}/${captureId}.json`);
    const subjectRef = cap ? String(dataOf(cap).subject_ref ?? "") : "";
    const individualId = subjectRef.startsWith("individual/")
      ? subjectRef.slice("individual/".length)
      : "";
    const thumbId = ulid();
    const manifest = {
      thumbnail_id: thumbId,
      capture_id: captureId,
      image_id: photoId,
      individual_id: individualId,
      thumbnail_path: thumbKey,
      width_px: thumb.width,
      height_px: thumb.height,
      format: thumb.format,
      schema_version: 1,
      run_id: photoId,
      created_at: new Date().toISOString(),
    };
    await store(c).putEventAt(
      `truth/${THUMBNAIL_TYPE}/${captureId}-${photoId}.json`,
      envelope(THUMBNAIL_TYPE, thumbId, "schemas/frozen/thumbnail.schema.json", actorId, manifest, {
        generator_kind: "agent",
        agent_name: "thumbnail-jsquash",
        input_event_ids: [photoId],
      }),
    );
  } catch {
    // non-image / codec failure → skip thumbnail; the upload already succeeded.
  }

  return c.json({
    photo_id: photoId,
    sha256: data.sha256,
    photo_conditions: conditions?.normalized ?? null,
    condition_alerts: conditions?.alerts ?? [],
  }, 202);
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
  if (body.scope !== undefined) data.scope = body.scope; // OBS-18 雌雄別/令齢別/置き場所別

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

  // OBS-10 query 自身除外: never rank the query capture(s) against themselves.
  const prototypeIds = Array.isArray(body.prototype_capture_ids)
    ? (body.prototype_capture_ids as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const excludeSet = new Set(
    [typeof body.query_capture_id === "string" ? body.query_capture_id : "", ...prototypeIds].filter(Boolean),
  );
  if (excludeSet.size) candidates = candidates.filter((x) => !excludeSet.has(String(x.capture_id)));

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
  let querySubjectRef = "";
  if (Array.isArray(body.query_vector)) {
    queryVec = Float32Array.from(body.query_vector as number[]);
  } else if (prototypeIds.length) {
    // OBS-10 prototype 平均ベクトル: mean of the prototype set's vectors.
    const vecs: Float32Array[] = [];
    for (const id of prototypeIds) {
      const v = await loadVector(c.env.TRUTH, id);
      if (v && v.length === EMBEDDING_DIM) vecs.push(v);
    }
    if (!vecs.length) return c.json({ error: "QUERY_EMBEDDING_NOT_FOUND" }, 400);
    const mean = new Float32Array(EMBEDDING_DIM);
    for (const v of vecs) for (let i = 0; i < EMBEDDING_DIM; i++) mean[i] += v[i] / vecs.length;
    queryVec = mean;
  } else if (typeof body.query_capture_id === "string") {
    queryVec = await loadVector(c.env.TRUTH, body.query_capture_id);
    if (!queryVec) return c.json({ error: "QUERY_EMBEDDING_NOT_FOUND" }, 400);
    const q = await store(c).readEvent(`truth/${CAPTURE_TYPE}/${body.query_capture_id}.json`);
    querySubjectRef = q ? String(dataOf(q).subject_ref ?? "") : "";
  }

  if (queryVec) {
    if (queryVec.length !== EMBEDDING_DIM) return c.json({ error: "QUERY_DIM_MISMATCH", dim: queryVec.length }, 400);
    stage = "embedding";
    const rerank = body.rerank === true;
    const scored: { capture_id: string; score: number; subject_ref: string }[] = [];
    for (const cap of candidates) {
      const capId = String(cap.capture_id);
      const vec = await loadVector(c.env.TRUTH, capId);
      if (!vec) continue; // no embedding for this capture
      if (vec.length !== EMBEDDING_DIM) continue; // 遮断: manifest embedding_dim ≠ 384 (CL-08)
      const cos = cosineSimilarity(queryVec, vec);
      const subjectRef = String(cap.subject_ref ?? "");
      // OBS-11 合成 rerank: blend embedding with lineage (shared individual);
      // color/size stay 欠測既定 until the client-side analysis wave lands.
      const score = rerank
        ? compositeScore({ embedding: cos, lineage: querySubjectRef && subjectRef === querySubjectRef ? 1 : undefined })
        : cos;
      scored.push({ capture_id: capId, score, subject_ref: subjectRef });
    }
    scored.sort((a, b) => b.score - a.score || a.capture_id.localeCompare(b.capture_id));

    // OBS-11 aggregateIndividual: collapse to one score per individual.
    const aggMethod = body.aggregate;
    if (aggMethod === "max" || aggMethod === "mean_top3" || aggMethod === "weighted_latest") {
      const byInd = new Map<string, number[]>();
      // chronological (capture_id ULID asc ⇒ time asc) for weighted_latest.
      for (const s of [...scored].sort((a, b) => a.capture_id.localeCompare(b.capture_id))) {
        if (!s.subject_ref) continue;
        (byInd.get(s.subject_ref) ?? byInd.set(s.subject_ref, []).get(s.subject_ref)!).push(s.score);
      }
      const individuals = [...byInd.entries()]
        .map(([subject_ref, scores]) => ({ subject_ref, score: aggregateIndividual(scores, aggMethod) }))
        .sort((a, b) => b.score - a.score || a.subject_ref.localeCompare(b.subject_ref));
      return c.json({ ladder_stage: stage, aggregate: aggMethod, individuals: individuals.slice(0, topK) });
    }

    return c.json({ ladder_stage: stage, results: scored.map((s) => ({ capture_id: s.capture_id, score: s.score })).slice(0, topK) });
  }

  return c.json({
    ladder_stage: stage,
    results: candidates.slice(0, topK).map((x) => ({ capture_id: String(x.capture_id) })),
  });
});

// GET /observation/measurement-dictionary — item_hash 登録辞書 (OBS-18). Derived
// from every template item that carries an item_hash (no dedicated dictionary
// event; templates ARE the registry).
obsRoutes.get("/observation/measurement-dictionary", async (c) => {
  const templates = (await store(c).listEvents(`truth/${TEMPLATE_TYPE}/`)).map(dataOf);
  const byHash = new Map<string, Record<string, unknown>>();
  for (const t of templates) {
    const items = Array.isArray(t.items) ? (t.items as Record<string, unknown>[]) : [];
    for (const it of items) {
      if (typeof it.item_hash === "string" && it.item_hash && !byHash.has(it.item_hash)) {
        byHash.set(it.item_hash, { item_hash: it.item_hash, label: it.label, kind: it.kind, unit: it.unit });
      }
    }
  }
  return c.json({ dictionary: [...byHash.values()] });
});

// POST /observation/dictionary-extensions — register an unregistered item
// (OBS-18: はい/今回だけ/常に). mode=always persists (append a single-item
// template so the item_hash joins the dictionary); mode=once acknowledges only.
obsRoutes.post("/observation/dictionary-extensions", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.label !== "string" || typeof body.kind !== "string") {
    return c.json({ error: "INVALID_BODY" }, 400);
  }
  if (body.mode !== "once" && body.mode !== "always") return c.json({ error: "INVALID_MODE" }, 400);
  const unit = typeof body.unit === "string" ? body.unit : undefined;
  const itemHash =
    typeof body.item_hash === "string" && body.item_hash
      ? body.item_hash
      : await sha256Hex(new TextEncoder().encode(`${body.label}|${body.kind}|${unit ?? ""}`));
  if (body.mode === "once") return c.json({ item_hash: itemHash, registered: false });

  const actorId = c.get("actorId");
  const templateId = ulid();
  const item: Record<string, unknown> = { label: body.label, kind: body.kind, item_hash: itemHash };
  if (unit) item.unit = unit;
  const res = await store(c).putEvent(
    envelope(TEMPLATE_TYPE, templateId, "schemas/events/obs-template.schema.json", actorId, {
      template_id: templateId,
      actor_id: actorId,
      title: `dict:${body.label}`,
      items: [item],
    }),
  );
  if (res.status === "invalid") return c.json({ error: "INVALID_TEMPLATE", details: res.errors }, 400);
  return c.json({ item_hash: itemHash, registered: true, template_id: templateId }, 202);
});

// POST /observation/measurements — appendMeasurement (OBS-06/18). value_origin is
// mandatory here (the obs-capture schema keeps it optional=ADDITIVE; the required
// gate lives in-route). Two measurements for one item with different origins
// (imputed vs estimated) are BOTH kept — the array has no per-item collapse.
obsRoutes.post("/observation/measurements", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ error: "INVALID_BODY" }, 400);
  const measurements = Array.isArray(body.measurements) ? (body.measurements as Record<string, unknown>[]) : null;
  if (!measurements || measurements.length === 0) return c.json({ error: "NO_MEASUREMENTS" }, 400);
  for (const m of measurements) {
    if (m.value_origin === undefined) return c.json({ error: "MEASUREMENT_VALUE_ORIGIN_REQUIRED" }, 400);
    if (typeof m.value_origin !== "string" || !VALUE_ORIGINS.has(m.value_origin)) {
      return c.json({ error: "INVALID_VALUE_ORIGIN" }, 400);
    }
  }
  // OBS-18 item_hash 未登録検出 against the measurement dictionary.
  const dict = new Set<string>();
  for (const t of (await store(c).listEvents(`truth/${TEMPLATE_TYPE}/`)).map(dataOf)) {
    for (const it of (Array.isArray(t.items) ? t.items : []) as Record<string, unknown>[]) {
      if (typeof it.item_hash === "string") dict.add(it.item_hash);
    }
  }
  const unregistered = [
    ...new Set(
      measurements
        .map((m) => (typeof m.item_hash === "string" ? m.item_hash : ""))
        .filter((h) => h && !dict.has(h)),
    ),
  ];

  const actorId = c.get("actorId");
  const captureId = typeof body.capture_id === "string" && body.capture_id ? body.capture_id : ulid();
  const data: Record<string, unknown> = { capture_id: captureId, actor_id: actorId, domain: body.domain, measurements };
  for (const k of ["subject_ref", "template_id", "entry_mode"] as const) if (body[k] !== undefined) data[k] = body[k];

  const res = await store(c).putEvent(
    envelope(CAPTURE_TYPE, captureId, "schemas/events/obs-capture.schema.json", actorId, data),
  );
  if (res.status === "invalid") return c.json({ error: "INVALID_CAPTURE", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_CAPTURE", key: res.key }, 409);
  return c.json({ capture_id: captureId, unregistered_item_hashes: unregistered }, 202);
});

// GET /observation/targets/catalog — local classification tree + QIDs (OBS-02).
obsRoutes.get("/observation/targets/catalog", (c) => {
  const families: Record<string, Record<string, CatalogLeaf[]>> = {};
  for (const leaf of catalogAll()) {
    const { family, genus } = leaf.taxonomy;
    ((families[family] ??= {})[genus] ??= []).push(leaf);
  }
  const tree = Object.entries(families).map(([family, genera]) => ({
    family,
    genera: Object.entries(genera).map(([genus, species]) => ({
      genus,
      species: species.map((l) => ({ qid: l.qid, scientific_name: l.scientific_name })),
    })),
  }));
  return c.json({ size: CATALOG_SIZE, question_bounds: NAVIGATOR_TARGET_QUESTIONS, families: tree });
});

// POST /observation/targets/search — 3 paths to a QID (OBS-02/03): name substring
// / yes-no deterministic binary search (7〜12 問収束) / tree navigation. Returns
// CANDIDATES/resolved QID only — never sets species_confirmed (確定は commit の
// user ゲート、AI は書けない).
obsRoutes.post("/observation/targets/search", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ error: "INVALID_BODY" }, 400);
  const all = catalogAll();

  if (body.mode === "name") {
    const q = typeof body.query === "string" ? body.query.toLowerCase() : "";
    if (!q) return c.json({ error: "MISSING_QUERY" }, 400);
    const candidates = all
      .filter((l) => l.scientific_name.toLowerCase().includes(q))
      .slice(0, 20)
      .map((l) => ({ qid: l.qid, scientific_name: l.scientific_name, taxonomy: l.taxonomy }));
    return c.json({ mode: "name", candidates });
  }

  if (body.mode === "tree") {
    const path = Array.isArray(body.path)
      ? (body.path as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    let pool = all;
    if (path[0]) pool = pool.filter((l) => l.taxonomy.family === path[0]);
    if (path[1]) pool = pool.filter((l) => l.taxonomy.genus === path[1]);
    if (path[2]) pool = pool.filter((l) => l.taxonomy.species === path[2]);
    if (path.length >= 3) {
      const leaf = pool[0];
      if (!leaf) return c.json({ error: "NOT_FOUND" }, 404);
      return c.json({ mode: "tree", resolved: { qid: leaf.qid, taxonomy: leaf.taxonomy } });
    }
    const rank = (["family", "genus", "species"] as const)[path.length];
    const children = [...new Set(pool.map((l) => l.taxonomy[rank]))];
    return c.json({ mode: "tree", children });
  }

  if (body.mode === "yesno") {
    // Stateless binary search: client replays its yes/no answers; each halves the
    // candidate range. 256 leaves ⇒ ceil(log2)=8 questions to isolate one QID.
    const answers = Array.isArray(body.answers) ? (body.answers as unknown[]).map(Boolean) : [];
    let lo = 0;
    let hi = all.length;
    let asked = 0;
    for (const a of answers) {
      if (hi - lo <= 1) break;
      const mid = (lo + hi) >> 1;
      if (a) lo = mid;
      else hi = mid;
      asked++;
    }
    if (hi - lo <= 1) {
      const leaf = all[lo];
      return c.json({ mode: "yesno", resolved: { qid: leaf.qid, taxonomy: leaf.taxonomy }, questions_asked: asked });
    }
    const mid = (lo + hi) >> 1;
    return c.json({ mode: "yesno", resolved: null, question: { index: asked, pivot: all[mid].scientific_name, remaining: hi - lo } });
  }

  return c.json({ error: "INVALID_MODE" }, 400);
});

// GET /observation/templates/{template_id} — one template with scope (OBS-18).
obsRoutes.get("/observation/templates/:template_id", async (c) => {
  const id = c.req.param("template_id");
  const t = await store(c).readEvent(`truth/${TEMPLATE_TYPE}/${id}.json`);
  if (!t) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json({ template: dataOf(t) });
});

// POST /observation/annotations — append a LabelMe AST annotation (OBS-46/47).
// Append-only: there is deliberately NO edit route — an auto-measured value can
// never be mutated (不変条項③). Manual annotations carry a value_origin tag.
obsRoutes.post("/observation/annotations", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.capture_id !== "string" || !body.capture_id) return c.json({ error: "INVALID_BODY" }, 400);
  if (typeof body.ast !== "object" || body.ast === null) return c.json({ error: "INVALID_AST" }, 400);
  const actorId = c.get("actorId");
  const annotationId = ulid();
  const data: Record<string, unknown> = {
    annotation_id: annotationId,
    capture_id: body.capture_id,
    ast: body.ast,
    actor_id: actorId,
    created_at: new Date().toISOString(),
  };
  if (body.value_origin !== undefined) {
    if (typeof body.value_origin !== "string" || !VALUE_ORIGINS.has(body.value_origin)) {
      return c.json({ error: "INVALID_VALUE_ORIGIN" }, 400);
    }
    data.value_origin = body.value_origin;
  }
  const key = `truth/${ANNOTATION_TYPE}/${body.capture_id}-${annotationId}.json`;
  const res = await store(c).putEventAt(
    key,
    envelope(ANNOTATION_TYPE, annotationId, "schemas/events/obs-annotation.schema.json", actorId, data),
  );
  if (res.status === "invalid") return c.json({ error: "INVALID_ANNOTATION", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_ANNOTATION", key: res.key }, 409);
  return c.json({ annotation_id: annotationId }, 202);
});

// POST /observation/{capture_id}/reanalyze — append a NEW analysis (OBS-48). Never
// overwrites a prior analysis; records delta + correction_semver; the original
// image is untouched.
obsRoutes.post("/observation/:capture_id/reanalyze", async (c) => {
  const captureId = c.req.param("capture_id");
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ error: "INVALID_BODY" }, 400);
  if (typeof body.results !== "object" || body.results === null) return c.json({ error: "MISSING_RESULTS" }, 400);
  if (typeof body.correction_semver !== "string") return c.json({ error: "MISSING_SEMVER" }, 400);
  const actorId = c.get("actorId");
  const analysisId = ulid();
  const data: Record<string, unknown> = {
    analysis_id: analysisId,
    capture_id: captureId,
    results: body.results,
    correction_semver: body.correction_semver,
    is_manual_edit: body.is_manual_edit === true,
    actor_id: actorId,
    created_at: new Date().toISOString(),
  };
  if (body.delta !== undefined) data.delta = body.delta;
  const key = `truth/${ANALYSIS_TYPE}/${captureId}-${analysisId}.json`;
  const res = await store(c).putEventAt(
    key,
    envelope(ANALYSIS_TYPE, analysisId, "schemas/events/obs-analysis.schema.json", actorId, data),
  );
  if (res.status === "invalid") return c.json({ error: "INVALID_ANALYSIS", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_ANALYSIS", key: res.key }, 409);
  return c.json({ analysis_id: analysisId }, 202);
});

// GET /observation/{capture_id}/reanalysis-manifest — every analysis for a capture
// (OBS-48), append order preserved.
obsRoutes.get("/observation/:capture_id/reanalysis-manifest", async (c) => {
  const captureId = c.req.param("capture_id");
  const analyses = (await store(c).listEvents(`truth/${ANALYSIS_TYPE}/${captureId}-`)).map(dataOf);
  analyses.sort((a, b) => String(a.analysis_id).localeCompare(String(b.analysis_id)));
  return c.json({ capture_id: captureId, count: analyses.length, analyses });
});

// GET /observation/{capture_id}/thumbnail/{photo_id} — 512px JPEG only (OBS-23).
// There is deliberately NO raw bulk-download route; thumbnails are the only
// image-listing surface beyond the single-photo /image/{photo_id}.
obsRoutes.get("/observation/:capture_id/thumbnail/:photo_id", async (c) => {
  const photoId = c.req.param("photo_id");
  const obj = await c.env.TRUTH.get(`media/thumbnail/${photoId}`);
  if (!obj) return c.json({ error: "NOT_FOUND" }, 404);
  return new Response(await obj.arrayBuffer(), { headers: { "content-type": "image/jpeg" } });
});

// POST /solid-observation/commit — the ONLY save path after the 3-screen confirm
// (OBS-25). Enforces the OBS-62/03 gate: a subspecies candidate must be
// user-confirmed (AI 自動確定禁止) before anything is written.
obsRoutes.post("/solid-observation/commit", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ error: "INVALID_BODY" }, 400);
  if (body.subspecies_candidate !== undefined && body.subspecies_confirmed_by !== "user") {
    return c.json({ error: "SUBSPECIES_NOT_CONFIRMED" }, 400);
  }
  const actorId = c.get("actorId");
  const captureId = typeof body.capture_id === "string" && body.capture_id ? body.capture_id : ulid();
  const data: Record<string, unknown> = { capture_id: captureId, actor_id: actorId };
  for (const k of CAPTURE_FIELDS) if (body[k] !== undefined) data[k] = body[k];
  const res = await store(c).putEvent(
    envelope(CAPTURE_TYPE, captureId, "schemas/events/obs-capture.schema.json", actorId, data),
  );
  if (res.status === "invalid") return c.json({ error: "INVALID_CAPTURE", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_CAPTURE", key: res.key }, 409);
  return c.json({ capture_id: captureId, committed: true }, 202);
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
// With ?prefill=1 (OBS-20): also returns entry_mode=qr + last-observation prefill
// (棚→個体→種→テンプレ連鎖) so the QR-resume form starts pre-filled. The bare
// call keeps its original { individual_id } shape (existing contract).
obsRoutes.get("/qr/:token", async (c) => {
  const token = c.req.param("token");
  const ev = await store(c).readEvent(`truth/${QR_TYPE}/${token}.json`);
  if (!ev) return c.json({ error: "NOT_FOUND" }, 404);
  const d = dataOf(ev);
  if (typeof d.expires_at === "string" && Date.parse(d.expires_at) < Date.now()) {
    return c.json({ error: "QR_EXPIRED" }, 410);
  }
  if (!c.req.query("prefill")) return c.json({ individual_id: d.individual_id });

  const ref = `individual/${d.individual_id}`;
  const caps = (await store(c).listEvents(`truth/${CAPTURE_TYPE}/`))
    .map(dataOf)
    .filter((x) => x.subject_ref === ref)
    .sort((a, b) => String(a.capture_id).localeCompare(String(b.capture_id)));
  const last = caps[caps.length - 1];
  const prefill = last
    ? {
        template_id: last.template_id ?? null,
        species_candidate: last.species_candidate ?? null,
        measurements: last.measurements ?? [],
      }
    : null;
  return c.json({ individual_id: d.individual_id, entry_mode: "qr", prefill });
});
