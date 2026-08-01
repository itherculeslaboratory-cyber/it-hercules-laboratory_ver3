// Observation core API (design-c2 §3.2). All routes PROTECTED — the auth
// middleware (index.ts §1.5) gates them and sets actorId. Every write stamps
// data.actor_id from the session principal (V3-AUT-17): a client-supplied
// actor_id in the body is ignored, never trusted.
import { Hono } from "hono";
import { TruthStore, ulid, cosineSimilarity, canonicalJson, sha256Hex as truthSha256Hex } from "@ihl/truth";
import { generateThumbnail } from "./thumbnail";
import { tagRemeasured } from "./tag-routes";
import { deriveDeviceBindingsForCapture, type DerivedDeviceBinding } from "./source-routes";
import { projectSellerModeration } from "./market-flag-routes";
import {
  RERANK_WEIGHTS,
  RERANK_MISSING,
  PERSONALIZE_WEIGHT,
  NAVIGATOR_TARGET_QUESTIONS,
  CONFIDENCE_ORDER,
  BOOTH_TYPES,
  CAPTURE_VIEWS,
  computeQcFlag,
  QC_FLAGS,
  MEDIA_CACHE_MAX_AGE_SEC,
  PRINT_ALLOWED_FIELDS,
  countConsentL3Inventory,
} from "./observation-constants";
import { ENV_QR_TYPE, projectOccupantsAt, projectOpenOccupancy, projectLabEnvironmentAt, projectCurrentOwner, projectTelemetryLatest } from "./source-routes";
import { projectIndividualSummary } from "./individual-routes";
import { parseObservationFreetext } from "./freetext-parser";
import { projectPreferenceWeights, dot } from "./match-routes";
import type { Bindings, Variables } from "./env";
import { appendContribution } from "./contribution";
import { CONTRIB_OBSERVATION_SAVED, CONTRIB_OBSERVATION_WITH_PHOTO } from "./economy-constants";
// 背骨S4(設計R0801-f383db §7 S4行): 新規routeのマウントに index.ts の変更を要求しない
// ための相乗り(KIT-TEMPLATE.md「触ってよいファイル」節の例外条項どおり)。cadence-routes.ts
// は自分の Hono サブアプリを export し、既に app.route("/api/v1", obsRoutes) で
// マウント済みのこの obsRoutes へ .route("/") で載せる。index.ts の import/app.route 行は
// 増やさない。
import { cadenceRoutes } from "./cadence-routes";

export const obsRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();
obsRoutes.route("/", cadenceRoutes);

const ANNOTATION_TYPE = "ihl.obs.annotation.v1";
const ANALYSIS_TYPE = "ihl.obs.analysis.v1";

// The 9 frozen provenance value_origin values (CONFIDENCE_ORDER is keyed by
// exactly this enum — reuse it so the gate can never drift from the schema).
export const VALUE_ORIGINS = new Set(Object.keys(CONFIDENCE_ORDER));

// ── shared commit gates (extracted so batch-commit reuses the SAME checks as
// solid-observation/commit and /observation/measurements — コピペ二重化しない) ──

/** OBS-62/03 亜種自動確定禁止ゲート: a subspecies candidate needs subspecies_confirmed_by==="user". */
export function subspeciesGateError(body: Record<string, unknown>): string | null {
  if (body.subspecies_candidate !== undefined && body.subspecies_confirmed_by !== "user") {
    return "SUBSPECIES_NOT_CONFIRMED";
  }
  return null;
}

/** value_origin, if present on a measurement, must be one of the 9 frozen values. */
export function measurementValueOriginError(measurements: unknown): string | null {
  if (!Array.isArray(measurements)) return null;
  for (const m of measurements as Record<string, unknown>[]) {
    if (m.value_origin === undefined) continue;
    if (typeof m.value_origin !== "string" || !VALUE_ORIGINS.has(m.value_origin)) return "INVALID_VALUE_ORIGIN";
  }
  return null;
}

// CL-08 / design-c3 §1: embeddings are frozen at 384 dims. A manifest whose
// embedding_dim differs is blocked from search (ver2 scoring.py:44 guard).
export const EMBEDDING_DIM = 384;

const CAPTURE_TYPE = "ihl.obs.capture.v1";
const PHOTO_TYPE = "ihl.obs.photo.v1";
const THUMBNAIL_TYPE = "ihl.obs.thumbnail.v1";
const TEMPLATE_TYPE = "ihl.obs.template.v1";
const QR_TYPE = "ihl.ind.qr.v1";
// OBS-12(view/file_kind)・OBS-58(qc_flag/qc_score) は既存の obs-photo frozen
// schema(additionalProperties:false)を拡張せず(=schema変更+ajv再生成は全艦
// 不可侵・packages/truthはw2-obsのglob外)、同じ capture-prefix キー規約の別
// レイヤーとして追記する(source-routes.ts projectLabEnvironmentAt と同型)。
const PHOTO_META_TYPE = "ihl.obs.photo_meta.v1";
// V3-OBS-64 R64-7最小版(design19 §T1-10・bridge2-addendum が obs-datasource.schema.json を追加)。
const DATASOURCE_TYPE = "ihl.obs.datasource.v1";
const DATASOURCE_SCHEMA = "schemas/events/obs-datasource.schema.json";

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
// exported for V3-UIX-82(検索グラフビュー): reused by
// individual-routes.ts projectEntityGraph to score 「近さ(画像類似)」without
// re-implementing the manifest/blob read.
export async function loadVector(
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

// V3-OBS-42: 数値条件(信頼性=ハードな除外ゲート)。以上(gte)/以下(lte)/付近(near)の
// 3方向を全次元で統一する — item ごとに異なるUI語彙を持たせない(要件文どおり)。
// near は許容誤差 tolerance(未指定なら target の10%)以内かで判定する。好み
// (ソフトなランキング=preferenceScore/personalize)とは別レイヤーとして分離。
export interface PreferenceFilter {
  item: string;
  target: number;
  direction: "gte" | "lte" | "near";
  tolerance?: number;
  [key: string]: unknown;
}

export function passesPreferenceFilters(
  cap: Record<string, unknown>,
  filters: PreferenceFilter[],
  measure: (cap: Record<string, unknown>, item: string) => number | null,
): boolean {
  for (const f of filters) {
    const v = measure(cap, f.item);
    if (v === null) return false; // 欠測は不確実性=除外(ハードゲートは推測しない)
    if (f.direction === "gte" && v < f.target) return false;
    if (f.direction === "lte" && v > f.target) return false;
    if (f.direction === "near") {
      const tol = f.tolerance ?? Math.abs(f.target) * 0.1;
      if (Math.abs(v - f.target) > tol) return false;
    }
  }
  return true;
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
  "life_stage_candidate",
  "measurements",
  "template_id",
  "entry_mode",
  "subspecies_candidate",
  "subspecies_confirmed_by",
  "photo_conditions",
  "note",
  "devices", // OBS-17: DeviceBinding/Occupancy自動派生のトリガー(commit1回で完結)
  "visibility", // V3-OBS-54段階2: 公開範囲(public/uid_linked/private・省略時public)
  "species_candidate_gbif_id", // V3-OBS-04: GBIF canonical_id(候補根拠・任意)
  "species_candidate_wikidata_qid", // V3-OBS-04: Wikidata Q番号(候補根拠・任意)
  "product_ref", // V3-MKT-44(観測側): mkt-product-node.schema.json への参照(任意)
  "lot_id", // V3-OBS-69: ロット別比較用(任意)
  "version_id", // V3-OBS-69: Ver別比較用(任意)
  "consent_l3", // g66-consent: L3(第三者提供・AI学習コーパス)許諾(任意・未指定=未許諾)
] as const;

// V3-OBS-54/A-8-b(AUT-15 観測閲覧READ公開化)の可視性判定(純関数)。
// actorId が undefined = 未ログイン閲覧(AUT-15でREADがpublicになった場合の想定)。
// private は本人(actor_id一致)のみ、uid_linked はログイン済みなら誰でも、
// public・未指定(既定public)は誰でも見える。「routeがpublic」と「データがpublic」は
// 別軸(発注書A-4整合)— この判定を通さずに visibility=private を露出させない。
export function captureVisibleTo(cap: Record<string, unknown>, actorId: string | undefined): boolean {
  const v = cap.visibility;
  if (v === "private") return cap.actor_id === actorId;
  if (v === "uid_linked") return actorId !== undefined;
  return true;
}

/** OBS-12: booth_type は BOOTH_TYPES(fixed/portable)以外を許さない。未指定は許容。
 *  frozen obs-capture schema(additionalProperties:false)は拡張せず(schema変更+
 *  ajv再生成は全艦不可侵)、booth記録はPHOTO_META_TYPE側(upload時)に持たせる。 */
function boothTypeError(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !(BOOTH_TYPES as readonly string[]).includes(value)) {
    return "INVALID_BOOTH_TYPE";
  }
  return null;
}

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

// V3-UIX-21: 好み(離散信号 y=+1/-1 で記録済み・match-routes.ts)を検索rerankへ反映
// する独立レイヤー。OBS-11 の compositeScore(embedding/color/size/lineage・sum=1.0・
// ADR-H-12)は変更せず、personalize=true の時だけ後段でブレンドする(既定挙動を壊さ
// ない)。w·x は値域が学習量に依存し無限大になり得るため、決定論的な非線形飽和
// (ロジスティック関数)で必ず [0,1] へ収める(ブラックボックスではない・GPU不要・
// O(n特徴量) — V3-IND-08 の数式エンジン要件どおり)。
export function preferenceScore(weights: number[], features: number[]): number {
  const raw = dot(weights, features);
  return 1 / (1 + Math.exp(-raw));
}

/** personalize=true の時、compositeScore(またはcos)へ好みを追加ブレンドする
 * (V3-UIX-21)。personalize=false/好み未学習(w=[])なら元の score をそのまま返す。 */
export function personalize(baseScore: number, preference: number | null): number {
  if (preference === null) return baseScore;
  return (1 - PERSONALIZE_WEIGHT) * baseScore + PERSONALIZE_WEIGHT * preference;
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

// R4 (OBS-R4 / T-71 GAP audit, 2026-07-19 critic-found): adding an observation
// to an individual is an owner-only write. Viewing an individual stays public,
// but appending a capture onto an individual whose current owner is someone
// else is fail-closed 403 NOT_OWNER — the same projectCurrentOwner boundary
// POST /occupancy and life-events already enforce (the audit's 模範). A subject
// with no determinable owner (no master AND no transfer — e.g. a clutch/* or
// device/* ref, or an orphan id) is not "someone else's individual" and passes
// through unchanged; only a KNOWN foreign owner is denied. Both HTTP capture
// write paths (this route + writeCaptureFromCommitBody) call this one guard.
async function captureSubjectDeniedForActor(
  bucket: Bindings["TRUTH"],
  actorId: string,
  subjectRef: unknown,
): Promise<boolean> {
  if (typeof subjectRef !== "string" || !subjectRef.startsWith("individual/")) return false;
  const id = subjectRef.slice("individual/".length);
  if (!id) return false;
  const owner = await projectCurrentOwner(bucket, id);
  return owner !== null && owner !== actorId;
}

// POST /observation/captures — append a capture event (202/400/409).
// capture_id: client MAY supply a ULID (idempotency key → 409 on replay);
// else generated. actor_id is ALWAYS the session principal (V3-AUT-17).
obsRoutes.post("/observation/captures", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ error: "INVALID_BODY" }, 400);
  const actorId = c.get("actorId");
  if (await captureSubjectDeniedForActor(c.env.TRUTH, actorId, body.subject_ref)) {
    return c.json({ error: "NOT_OWNER" }, 403);
  }
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

  // OBS-12: 標準撮影チャンバーの5視点(上面/正面/背面/左右)+RAW(dng・正)/JPG(確認用)
  // の対応づけ。未指定は許容(既存の単純アップロード経路を壊さない=OBS-12は既存
  // フローへの追加情報)。
  const viewRaw = form?.get("view");
  if (viewRaw !== null && viewRaw !== undefined) {
    if (typeof viewRaw !== "string" || !(CAPTURE_VIEWS as readonly string[]).includes(viewRaw)) {
      return c.json({ error: "INVALID_VIEW" }, 400);
    }
  }
  const fileKindRaw = form?.get("file_kind");
  if (fileKindRaw !== null && fileKindRaw !== undefined && fileKindRaw !== "raw" && fileKindRaw !== "jpg") {
    return c.json({ error: "INVALID_FILE_KIND" }, 400);
  }
  const boothIdRaw = form?.get("booth_id");
  const boothTypeRaw = form?.get("booth_type");
  const boothErr = boothTypeError(boothTypeRaw);
  if (boothErr) return c.json({ error: boothErr }, 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = file.type || "application/octet-stream";
  const photoId = ulid();
  const mediaKey = `media/photo/${photoId}`;

  await store(c).putBlob(mediaKey, bytes, contentType);

  const sha256 = await sha256Hex(bytes);

  // V3-OBS-65: 「取り込みは自分自身のもの」— 他ユーザーが既にアップロード済みの
  // 同一sha256(=同じバイト列)を検出する(親画像が偶然被るのは許容=拒否せず
  // 検出のみ)。自分自身の再アップロードは対象外(同一actor_idは除外)。
  const priorSameHash = (await store(c).listEvents(`truth/${PHOTO_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.sha256 === sha256 && d.actor_id !== actorId);
  const reuseDetected = priorSameHash.length > 0;

  const data = {
    photo_id: photoId,
    capture_id: captureId,
    actor_id: actorId,
    media_key: mediaKey,
    content_type: contentType,
    size_bytes: bytes.length,
    sha256,
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

    // OBS-58: QC builder — decoded dimensions become available only once the
    // thumbnail succeeds (blur/occlusion 判定は client-side WASM 拡張の余地・
    // 誇張ゼロのため中立値0.5に留める。既定はLLM/Vision OFF=不変条項①)。
    const qc = computeQcFlag(thumb.width, thumb.height, bytes.length);
    const metaData: Record<string, unknown> = {
      photo_id: photoId,
      capture_id: captureId,
      qc_flag: qc.qc_flag,
      qc_score: qc.qc_score,
      qc_reasons: qc.reasons,
    };
    if (typeof viewRaw === "string") metaData.view = viewRaw;
    if (fileKindRaw === "raw" || fileKindRaw === "jpg") metaData.file_kind = fileKindRaw;
    if (typeof boothIdRaw === "string" && boothIdRaw) metaData.booth_id = boothIdRaw;
    if (typeof boothTypeRaw === "string") metaData.booth_type = boothTypeRaw;
    await store(c).putEventAt(
      `truth/${PHOTO_META_TYPE}/${captureId}-${photoId}.json`,
      envelope(PHOTO_META_TYPE, photoId, "schemas/events/obs-photo-meta.schema.json", actorId, metaData),
    );
  } catch {
    // non-image / codec failure → skip thumbnail/QC; the upload already succeeded.
  }

  return c.json({
    photo_id: photoId,
    sha256: data.sha256,
    photo_conditions: conditions?.normalized ?? null,
    condition_alerts: conditions?.alerts ?? [],
    possible_reuse: reuseDetected, // OBS-65: 検出のみ・ブロックしない
  }, 202);
});

// GET /observation/{capture_id}/qc — QC flags for every photo of a capture
// (OBS-58: 検索UIでQCフィルタ可能にする土台の read 側)。
obsRoutes.get("/observation/:capture_id/qc", async (c) => {
  const captureId = c.req.param("capture_id");
  const rows = (await store(c).listEvents(`truth/${PHOTO_META_TYPE}/${captureId}-`)).map(dataOf);
  return c.json({ capture_id: captureId, photos: rows });
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
  const searchActorId = c.get("actorId"); // A-8-b/AUT-15: undefined if未ログイン(将来のpublic化に備える)

  // ponytail: full capture-type prefix scan, O(n) per query — no resident index
  // (design-c3 §1 "R2 list→都度計算"). A projection index is a later rung if n grows.
  let candidates = (await store(c).listEvents(`truth/${CAPTURE_TYPE}/`)).map(dataOf);
  candidates.sort((a, b) => String(a.capture_id).localeCompare(String(b.capture_id)));
  // V3-OBS-54段階2: 一覧投影から非公開を除外(research-content-routes.ts:235と同型)。
  candidates = candidates.filter((x) => captureVisibleTo(x, searchActorId));

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
  // OBS-58: QCフィルタ — 少なくとも1枚の写真が指定qc_flagを持つcaptureのみ残す。
  if (typeof body.qc_flag === "string" && (QC_FLAGS as readonly string[]).includes(body.qc_flag)) {
    const kept: typeof candidates = [];
    for (const cand of candidates) {
      const metas = (await store(c).listEvents(`truth/${PHOTO_META_TYPE}/${String(cand.capture_id)}-`)).map(dataOf);
      if (metas.some((m) => m.qc_flag === body.qc_flag)) kept.push(cand);
    }
    candidates = kept;
  }
  // OBS-42: pref_filters — 以上/以下/付近の統一方向指定によるハードゲート
  // (好み(ソフトランキング)とは別レイヤー・§本文どおり信頼性=除外ゲート)。
  if (Array.isArray(body.pref_filters) && body.pref_filters.length > 0) {
    const filters = (body.pref_filters as Record<string, unknown>[])
      .filter(
        (f): f is PreferenceFilter =>
          typeof f.item === "string" &&
          typeof f.target === "number" &&
          (f.direction === "gte" || f.direction === "lte" || f.direction === "near"),
      )
      .map((f) => ({ ...f, tolerance: typeof f.tolerance === "number" ? f.tolerance : undefined }));
    candidates = candidates.filter((cand) => passesPreferenceFilters(cand, filters, measureValue));
  }
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
    // V3-UIX-21: personalize=true の時だけ本人の学習済み好みベクトルを1回取得し、
    // 各候補へ後段ブレンド(personalizeWeight)する。好み未学習(events 0件)は w=[]
    // → preferenceScore の dot が常に0 → sigmoid(0)=0.5 で無害(中立)に縮退する。
    const personalizeOn = body.personalize === true;
    const prefWeights = personalizeOn ? await projectPreferenceWeights(store(c), c.get("actorId")) : null;
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
      const baseScore = rerank
        ? compositeScore({ embedding: cos, lineage: querySubjectRef && subjectRef === querySubjectRef ? 1 : undefined })
        : cos;
      const score = prefWeights
        ? personalize(baseScore, preferenceScore(prefWeights, Array.from(vec)))
        : baseScore;
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
      // V3-OBS-24 類似個体サイドバー: subject_ref ("individual/<id>") alongside
      // the bare individual_id (same derivation as GET /observation/{capture_id})
      // so the UI can navigate to /individuals/<id> without string-manipulating
      // a template — additive, subject_ref is unchanged for existing callers.
      const individuals = [...byInd.entries()]
        .map(([subject_ref, scores]) => ({
          subject_ref,
          individual_id: subject_ref.startsWith("individual/") ? subject_ref.slice("individual/".length) : undefined,
          score: aggregateIndividual(scores, aggMethod),
        }))
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

// ── OBS-57 種候補提案チェーン: ヒューリスティック → CLIP(任意) → Vision(任意) ──

export interface SpeciesCandidate {
  species: string;
  score: number;
  method: "heuristic" | "clip" | "vision";
}
export interface SpeciesSuggestionResult {
  candidates: SpeciesCandidate[];
  method_used: "heuristic" | "clip" | "vision";
  degraded: string[];
}

/**
 * Heuristic tier (always-on, zero-cost, no LLM/Vision — invariant①): nearest
 * user-CONFIRMED captures (species_confirmed_by==="user") by cosine similarity,
 * aggregated by species_candidate (mean of contributing scores). Pure reuse of
 * the SAME embedding infra as /observation/search — no new index/model.
 */
export async function heuristicSpeciesCandidatesFromVector(
  s: TruthStore,
  bucket: Bindings["TRUTH"],
  queryVec: Float32Array,
  excludeCaptureId?: string,
): Promise<SpeciesCandidate[]> {
  const confirmed = (await s.listEvents(`truth/${CAPTURE_TYPE}/`))
    .map(dataOf)
    .filter((x) => x.species_confirmed_by === "user" && typeof x.species_candidate === "string" && x.capture_id !== excludeCaptureId);
  const bySpecies = new Map<string, number[]>();
  for (const cap of confirmed) {
    const vec = await loadVector(bucket, String(cap.capture_id));
    if (!vec || vec.length !== EMBEDDING_DIM) continue;
    const cos = cosineSimilarity(queryVec, vec);
    const species = String(cap.species_candidate);
    (bySpecies.get(species) ?? bySpecies.set(species, []).get(species)!).push(cos);
  }
  return [...bySpecies.entries()]
    .map(([species, scores]) => ({ species, score: scores.reduce((a, b) => a + b, 0) / scores.length, method: "heuristic" as const }))
    .sort((a, b) => b.score - a.score || a.species.localeCompare(b.species));
}

/**
 * OBS-57 chain: heuristic runs first (always). Only escalates to CLIP, then
 * Vision, when the heuristic tier found NOTHING (no confirmed neighbors yet —
 * a cold-start case). clip/vision are OPTIONAL injected async callables — the
 * production route wires them from env-configured endpoints ONLY (both unset
 * by default: invariant① LLM/Vision既定OFF). When a tier is unset OR returns
 * no candidates, that is recorded in `degraded` (劣化運用を隠さない) and the
 * chain still COMPLETES — it never throws/blocks on a missing optional tier.
 * The caller NEVER auto-confirms a species from this result — species_confirmed_by
 * stays a frozen `const: "user"` in the capture schema (V3-OBS-03, unchanged).
 */
export async function suggestSpeciesCandidates(
  heuristicCandidates: SpeciesCandidate[],
  opts: {
    clip?: (() => Promise<SpeciesCandidate[] | null>) | null;
    vision?: (() => Promise<SpeciesCandidate[] | null>) | null;
  } = {},
): Promise<SpeciesSuggestionResult> {
  if (heuristicCandidates.length) {
    return { candidates: heuristicCandidates, method_used: "heuristic", degraded: [] };
  }
  const degraded: string[] = ["heuristic_no_match"];
  if (opts.clip) {
    const r = await opts.clip();
    if (r && r.length) return { candidates: r, method_used: "clip", degraded };
    degraded.push("clip_no_match");
  } else {
    degraded.push("clip_not_configured");
  }
  if (opts.vision) {
    const r = await opts.vision();
    if (r && r.length) return { candidates: r, method_used: "vision", degraded };
    degraded.push("vision_no_match");
  } else {
    degraded.push("vision_not_configured");
  }
  return { candidates: [], method_used: "heuristic", degraded };
}

// ── V3-OBS-04: GBIF/Wikidata 外部ID取得(bridge艦がschemaへ追加済みの
// species_candidate_gbif_id/species_candidate_wikidata_qidへの書き込み元)。
// OBS-57のclip/vision chainと同じ「注入可能な非同期呼び出し・失敗はベストエフォート
// 劣化(nullを返すだけでrouteは落とさない)」パターンを踏襲。fetcherを注入できるため
// テストは実ネットワークに依存しない(pure以外の唯一の例外=I/O自体が目的の関数)。

/** GBIF species/match APIから canonical usageKey(GBIF ID)を取得(ベストエフォート)。
 *  一致なし/エラーはnull(誇張ゼロ・でっち上げない)。 */
export async function lookupGbifCanonicalId(
  scientificName: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const res = await fetcher(`https://api.gbif.org/v1/species/match?name=${encodeURIComponent(scientificName)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { usageKey?: number; matchType?: string };
    if (body.matchType === "NONE" || typeof body.usageKey !== "number") return null;
    return String(body.usageKey);
  } catch {
    return null;
  }
}

/** Wikidata wbsearchentities APIからQ番号を取得(ベストエフォート)。 */
export async function lookupWikidataQid(
  scientificName: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(scientificName)}&language=en&format=json&type=item&limit=1`;
    const res = await fetcher(url);
    if (!res.ok) return null;
    const body = (await res.json()) as { search?: { id?: string }[] };
    const id = body.search?.[0]?.id;
    return typeof id === "string" && /^Q[0-9]+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

// GET /observation/species-candidates/external-ids?scientific_name=... — V3-OBS-04:
// GBIF/Wikidata照会結果を提示するのみ(確定・保存はしない)。クライアントが確認後、
// POST /observation/captures の species_candidate_gbif_id/species_candidate_wikidata_qid
// として明示的に送って初めてTruthへ入る(species_confirmed_by==="user"契約と同型・
// 外部照会結果を自動確定しない)。
obsRoutes.get("/observation/species-candidates/external-ids", async (c) => {
  const name = c.req.query("scientific_name");
  if (!name) return c.json({ error: "INVALID_QUERY", details: ["scientific_name required"] }, 400);
  const [gbif_id, wikidata_qid] = await Promise.all([lookupGbifCanonicalId(name), lookupWikidataQid(name)]);
  return c.json({ scientific_name: name, gbif_id, wikidata_qid });
});

// GET /observation/{capture_id}/species-suggestions — OBS-57 種候補提案(確定はしない・
// 提示のみ)。CLIP/Vision未設定(既定)でもヒューリスティックのみで必ず完走する。
obsRoutes.get("/observation/:capture_id/species-suggestions", async (c) => {
  const captureId = c.req.param("capture_id");
  // R65-6: 詳細route(route-012)と同型の可視性ゲート。非公開は存在ごと404で隠す。
  const capture = await store(c).readEvent(`truth/${CAPTURE_TYPE}/${captureId}.json`);
  if (!capture || !captureVisibleTo(dataOf(capture), c.get("actorId"))) {
    return c.json({ error: "NOT_FOUND" }, 404);
  }
  const queryVec = await loadVector(c.env.TRUTH, captureId);
  if (!queryVec) return c.json({ error: "QUERY_EMBEDDING_NOT_FOUND" }, 404);
  const heuristic = await heuristicSpeciesCandidatesFromVector(store(c), c.env.TRUTH, queryVec, captureId);
  const result = await suggestSpeciesCandidates(heuristic); // clip/vision未設定(既定OFF)
  return c.json(result);
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

// csvField — RFC4180 最小エスケープ(カンマ/ダブルクォート/改行を含む値のみクォート)。
function csvField(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// PPR-12「全データCSVダウンロード」— capture の measurements[] を1行1計測値に展開した
// フラットCSV(研究者向け・決定論・重処理なしのI/Oのみ=不変条項①のサーバ負荷ゼロと矛盾しない)。
const CSV_COLUMNS = ["capture_id", "subject_ref", "domain", "item", "value", "unit", "value_origin", "observed_at"] as const;

export function capturesToCsv(captures: Record<string, unknown>[]): string {
  const header = CSV_COLUMNS.join(",");
  const rows: string[] = [];
  for (const cap of captures) {
    const measurements = Array.isArray(cap.measurements) ? (cap.measurements as Record<string, unknown>[]) : [];
    for (const m of measurements) {
      rows.push(
        CSV_COLUMNS.map((col) =>
          csvField(
            col === "capture_id" ? cap.capture_id
              : col === "subject_ref" ? cap.subject_ref
              : col === "domain" ? cap.domain
              : m[col],
          ),
        ).join(","),
      );
    }
  }
  return [header, ...rows].join("\n") + "\n";
}

// GET /observation/export — 全 capture の measurements を CSV でダウンロード(PPR-12)。実解析
// (SIMD/LUT/ROI Lab変換)は端末側で完結する設計のため、本 route は既存 Truth データの決定論
// シリアライズのみ(重処理なし・サーバ負荷ゼロを維持)。静的パス(/observation/:capture_id 等
// 動的routeより前に登録=パス衝突回避・OBS-18 系の他の静的routeと同じ配置規約)。
obsRoutes.get("/observation/export", async (c) => {
  const captures = (await store(c).listEvents(`truth/${CAPTURE_TYPE}/`))
    .map(dataOf)
    .sort((a, b) => String(a.capture_id).localeCompare(String(b.capture_id)));
  return new Response(capturesToCsv(captures), {
    headers: { "content-type": "text/csv", "content-disposition": 'attachment; filename="observations.csv"' },
  });
});

// GET /observation/consent-l3-inventory — g66-consent: 既存captureのL3許諾内訳
// (granted/denied/missing)を読み取り専用で数える(遡及書き換えの代替=T2禁止事項
// 「既存データの遡及書き換え」を犯さずに「将来売れない在庫」を可視化する)。
obsRoutes.get("/observation/consent-l3-inventory", async (c) => {
  const captures = (await store(c).listEvents(`truth/${CAPTURE_TYPE}/`)).map(dataOf) as {
    consent_l3?: boolean;
  }[];
  return c.json(countConsentL3Inventory(captures));
});

// V3-OBS-71: 観測データ印刷 — 個体詳細から欲しいデータ項目(チェックボックス)と
// 期間指定で範囲選択する。実際の印刷はブラウザ print で足りる(ds_why実装方針)
// ため、本 route はフィールド選択+期間フィルタ済みの構造化データを返すのみ
// (PDF生成等の重処理は行わない=不変条項①)。
export function selectObservationFieldsInRange(
  captures: Record<string, unknown>[],
  fields: string[],
  range?: { from?: string; to?: string },
): Record<string, unknown>[] {
  const allowed = fields.filter((f) => (PRINT_ALLOWED_FIELDS as readonly string[]).includes(f));
  return captures
    .filter((cap) => {
      if (!range?.from && !range?.to) return true;
      const pc = cap.photo_conditions as Record<string, unknown> | undefined;
      const observedAt = typeof pc?.captured_at === "string" ? pc.captured_at : null;
      if (!observedAt) return false; // 期間指定時、日付が特定できないcaptureは範囲選択に含めない(誇張ゼロ)
      if (range.from && observedAt < range.from) return false;
      if (range.to && observedAt > range.to) return false;
      return true;
    })
    .map((cap) => {
      const row: Record<string, unknown> = {};
      for (const f of allowed) {
        if (f === "observed_at") {
          const pc = cap.photo_conditions as Record<string, unknown> | undefined;
          row.observed_at = typeof pc?.captured_at === "string" ? pc.captured_at : null;
        } else {
          row[f] = cap[f] ?? null;
        }
      }
      return row;
    });
}

// GET /individuals/{individual_id}/observations/print?fields=a,b&from=&to=
obsRoutes.get("/individuals/:individual_id/observations/print", async (c) => {
  const individualId = c.req.param("individual_id");
  const ref = `individual/${individualId}`;
  const fieldsParam = c.req.query("fields");
  const fields = fieldsParam ? fieldsParam.split(",").map((f) => f.trim()).filter(Boolean) : [...PRINT_ALLOWED_FIELDS];
  const from = c.req.query("from");
  const to = c.req.query("to");
  const captures = (await store(c).listEvents(`truth/${CAPTURE_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.subject_ref === ref);
  const rows = selectObservationFieldsInRange(captures, fields, { from, to });
  return c.json({ individual_id: individualId, fields, range: { from: from ?? null, to: to ?? null }, rows });
});

// V3-OBS-66: 変化の理由を残す観測ログレイヤー — 観測ドメイン(w2-obs glob)内の
// 全操作(capture/photo/analysis/annotation/device)を誰が・いつ・何をしたかで
// 一覧する。プラチナ/貢献度/カルマの履歴(economy/contribution domain)は
// w1-mkt/w1-gov glob側の責務のため対象外(誇張せず明記)。actor本人スコープ。
obsRoutes.get("/observation/activity-log", async (c) => {
  const actorId = c.get("actorId");
  const s = store(c);
  const entries: { type: string; id: string; actor_id: string; at: string; capture_id?: string }[] = [];
  for (const d of (await s.listEvents(`truth/${CAPTURE_TYPE}/`)).map(dataOf)) {
    if (d.actor_id !== actorId) continue;
    entries.push({ type: "capture", id: String(d.capture_id), actor_id: String(d.actor_id), at: String(d.capture_id) });
  }
  for (const d of (await s.listEvents(`truth/${PHOTO_TYPE}/`)).map(dataOf)) {
    if (d.actor_id !== actorId) continue;
    entries.push({ type: "photo", id: String(d.photo_id), actor_id: String(d.actor_id), at: String(d.photo_id), capture_id: String(d.capture_id) });
  }
  for (const d of (await s.listEvents(`truth/${ANALYSIS_TYPE}/`)).map(dataOf)) {
    if (d.actor_id !== actorId) continue;
    entries.push({ type: "analysis", id: String(d.analysis_id), actor_id: String(d.actor_id), at: String(d.created_at ?? d.analysis_id), capture_id: String(d.capture_id) });
  }
  for (const d of (await s.listEvents(`truth/${ANNOTATION_TYPE}/`)).map(dataOf)) {
    if (d.actor_id !== actorId) continue;
    entries.push({ type: "annotation", id: String(d.annotation_id), actor_id: String(d.actor_id), at: String(d.created_at ?? d.annotation_id), capture_id: String(d.capture_id) });
  }
  // ULID の字句順は生成時刻順(design-c2既定の前提)。created_at を持たないevent型は
  // その id(ULID)自体で時系列にソートする。
  entries.sort((a, b) => a.at.localeCompare(b.at));
  return c.json({ actor_id: actorId, entries, note: "economy/contribution(プラチナ・カルマ)履歴はw1-mkt/w1-gov glob側の責務のため対象外" });
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
  }
  const originErr = measurementValueOriginError(measurements);
  if (originErr) return c.json({ error: originErr }, 400);
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
  for (const k of ["subject_ref", "template_id", "entry_mode", "consent_l3"] as const) if (body[k] !== undefined) data[k] = body[k];

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

// POST /observation/parse-freetext — V3-OBS-61 最小観測入力UI: 自然言語の
// フリーテキスト1つ+「解析する」ボタンを受け、日付・個体・温度・湿度・胸角・
// エサの行パターンを決定論パーサ(freetext-parser.ts・LLM 既定OFF)でJSON化
// して返すだけ(R2コミットは既存 obs-entry/solid-observation の役目・ここでは
// 提案止まり — 候補提示と確定の分離と同じ原則)。
obsRoutes.post("/observation/parse-freetext", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const text = typeof body?.text === "string" ? body.text : "";
  if (!text.trim()) return c.json({ error: "MISSING_TEXT" }, 400);
  return c.json(parseObservationFreetext(text));
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
    // V3-SEC-42: SHA-256(canonicalJson(ast)) — ROI マスク(アノテーション AST)の改ざん
    // 検出用。書込時にサーバが算出し append(手で供給不可・overwrite 不可=不変条項③)。
    ast_sha256: await truthSha256Hex(canonicalJson(body.ast)),
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

// Shared reanalyze write (OBS-48), reused by both the standalone route and
// POST /observation/batch-commit kind:"reanalyze" (PPR-12 Recompute All・
// コピペ二重化しない・同一ゲート). The heavy per-image compute (SIMD/LUT/ROI Lab
// 変換・マルチスレッド)runs on the CLIENT device (PPR-12「完全ローカル計算で
// サーバー負荷ゼロ」); this function only appends the already-computed result +
// logs the diff(delta) — it never re-derives results server-side.
export async function writeAnalysisFromReanalyzeBody(
  s: TruthStore,
  actorId: string,
  captureId: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; analysis_id: string } | { ok: false; error: string; details?: string[] }> {
  if (typeof body.results !== "object" || body.results === null) return { ok: false, error: "MISSING_RESULTS" };
  if (typeof body.correction_semver !== "string") return { ok: false, error: "MISSING_SEMVER" };
  const analysisId = ulid();
  const data: Record<string, unknown> = {
    analysis_id: analysisId,
    capture_id: captureId,
    results: body.results,
    // V3-SEC-42: SHA-256(canonicalJson(results)) — 解析結果 JSON の改ざん検出・R2
    // データ完全性・論文提出時の真正性証明用。サーバが書込時に算出(手で供給不可)。
    results_sha256: await truthSha256Hex(canonicalJson(body.results)),
    correction_semver: body.correction_semver,
    is_manual_edit: body.is_manual_edit === true,
    actor_id: actorId,
    created_at: new Date().toISOString(),
  };
  if (body.delta !== undefined) data.delta = body.delta;
  const key = `truth/${ANALYSIS_TYPE}/${captureId}-${analysisId}.json`;
  const res = await s.putEventAt(
    key,
    envelope(ANALYSIS_TYPE, analysisId, "schemas/events/obs-analysis.schema.json", actorId, data),
  );
  if (res.status === "invalid") return { ok: false, error: "INVALID_ANALYSIS", details: res.errors };
  if (res.status === "conflict") return { ok: false, error: "DUPLICATE_ANALYSIS" };
  await tagRemeasured(s, actorId, captureId); // OBS-07: 再測定タグ自動付与(標準経路・batch-commit reanalyze経路の両方に適用)
  return { ok: true, analysis_id: analysisId };
}

// POST /observation/{capture_id}/reanalyze — append a NEW analysis (OBS-48). Never
// overwrites a prior analysis; records delta + correction_semver; the original
// image is untouched.
obsRoutes.post("/observation/:capture_id/reanalyze", async (c) => {
  const captureId = c.req.param("capture_id");
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ error: "INVALID_BODY" }, 400);
  const actorId = c.get("actorId");
  const r = await writeAnalysisFromReanalyzeBody(store(c), actorId, captureId, body);
  if (!r.ok) return c.json({ error: r.error, details: r.details }, r.error === "DUPLICATE_ANALYSIS" ? 409 : 400);
  return c.json({ analysis_id: r.analysis_id }, 202);
});

// GET /observation/{capture_id}/reanalysis-manifest — every analysis for a capture
// (OBS-48), append order preserved.
obsRoutes.get("/observation/:capture_id/reanalysis-manifest", async (c) => {
  const captureId = c.req.param("capture_id");
  // R65-6: 詳細route(route-012)と同型の可視性ゲート。非公開は存在ごと404で隠す。
  const capture = await store(c).readEvent(`truth/${CAPTURE_TYPE}/${captureId}.json`);
  if (!capture || !captureVisibleTo(dataOf(capture), c.get("actorId"))) {
    return c.json({ error: "NOT_FOUND" }, 404);
  }
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
  // OBS-38 低コスト改善①: サムネイルは photo_id 毎に不変(再生成しない限り再利用
  // 可能) — ブラウザ/中間キャッシュでの重複fetchを避けるcache-control。
  return new Response(await obj.arrayBuffer(), {
    headers: { "content-type": "image/jpeg", "cache-control": `public, max-age=${MEDIA_CACHE_MAX_AGE_SEC}` },
  });
});

// Shared commit-path capture write (OBS-25/62/03), reused by
// POST /observation/batch-commit kind:"capture" (body = 同一形状・同一ゲート —
// コピペ二重化しない). Gates: subspecies 自動確定禁止 + value_origin(値あれば
// enum内). bucket (raw R2) is used ONLY for the OBS-17 device_bindings
// derivation below — the capture write itself still goes through TruthStore s.
export async function writeCaptureFromCommitBody(
  s: TruthStore,
  bucket: Bindings["TRUTH"],
  actorId: string,
  body: Record<string, unknown>,
): Promise<
  | { ok: true; capture_id: string; device_bindings: DerivedDeviceBinding[] }
  | { ok: false; error: string; details?: string[] }
> {
  const gateErr = subspeciesGateError(body);
  if (gateErr) return { ok: false, error: gateErr };
  const originErr = measurementValueOriginError(body.measurements);
  if (originErr) return { ok: false, error: originErr };
  // GOV-35 観測モジュール側freeze: round-15裁定 #6/#7 の逐語「GOV-35=出品/観測の
  // 機械的範囲停止・可逆」により、既存の出品側 suspended 投影(market-flag-routes)
  // をそのまま観測commitの入口にも適用する(新しい設計を発明せず、既承認の signal
  // を再利用するのみ)。suspended は誤BAN復帰(misban-reversal)で自動的に false へ
  // 戻るため、観測側にも別の解除操作は不要(可逆性はprojectSellerModerationに一本化)。
  if ((await projectSellerModeration(s, actorId)).suspended) {
    return { ok: false, error: "OBSERVATION_FROZEN" };
  }
  // R4 (OBS-R4): same owner-only boundary as the direct POST /observation/captures
  // route — the 追観測 UI saves through here (/solid-observation/commit), and
  // batch-commit kind:"capture" also routes through this function.
  if (await captureSubjectDeniedForActor(bucket, actorId, body.subject_ref)) {
    return { ok: false, error: "NOT_OWNER" };
  }
  const captureId = typeof body.capture_id === "string" && body.capture_id ? body.capture_id : ulid();
  const data: Record<string, unknown> = { capture_id: captureId, actor_id: actorId };
  for (const k of CAPTURE_FIELDS) if (body[k] !== undefined) data[k] = body[k];
  const res = await s.putEvent(
    envelope(CAPTURE_TYPE, captureId, "schemas/events/obs-capture.schema.json", actorId, data),
  );
  if (res.status === "invalid") return { ok: false, error: "INVALID_CAPTURE", details: res.errors };
  if (res.status === "conflict") return { ok: false, error: "DUPLICATE_CAPTURE" };

  // V3-KRM-28: 観測commit成功時の研究貢献度フック(axis=research・source=observation)。
  // observation_saved は毎回固定 +5、その上で当該 capture に既存の写真(先に
  // /observation/upload 済み)があれば with_photo 追加 +3(排他ではなく加算)。
  // ベストエフォート: 貢献付与の失敗でcommit自体を失敗させない(観測の保存が主目的)。
  try {
    await appendContribution(s, actorId, captureId, "research", CONTRIB_OBSERVATION_SAVED, "observation");
    const photos = await s.listEvents(`truth/${PHOTO_TYPE}/${captureId}-`);
    if (photos.length > 0) {
      await appendContribution(s, actorId, captureId, "research", CONTRIB_OBSERVATION_WITH_PHOTO, "observation");
    }
  } catch (e) {
    console.error("KRM-28 contribution hook failed (commit itself already succeeded):", e);
  }

  // OBS-17: devices[] declared on the commit body auto-derives DeviceBinding/
  // Occupancy — no separate binding API call needed (commit1回で完結).
  const deviceIds = Array.isArray(body.devices) ? body.devices.filter((x): x is string => typeof x === "string") : [];
  const deviceBindings = deviceIds.length
    ? await deriveDeviceBindingsForCapture(bucket, actorId, typeof body.subject_ref === "string" ? body.subject_ref : "", deviceIds)
    : [];

  return { ok: true, capture_id: captureId, device_bindings: deviceBindings };
}

// POST /solid-observation/commit — the ONLY save path after the 3-screen confirm
// (OBS-25). Enforces the OBS-62/03 gate: a subspecies candidate must be
// user-confirmed (AI 自動確定禁止) before anything is written.
obsRoutes.post("/solid-observation/commit", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ error: "INVALID_BODY" }, 400);
  const actorId = c.get("actorId");
  const r = await writeCaptureFromCommitBody(store(c), c.env.TRUTH, actorId, body);
  if (!r.ok) {
    const status =
      r.error === "DUPLICATE_CAPTURE" ? 409 : r.error === "OBSERVATION_FROZEN" || r.error === "NOT_OWNER" ? 403 : 400;
    return c.json({ error: r.error, details: r.details }, status);
  }
  return c.json({ capture_id: r.capture_id, committed: true, device_bindings: r.device_bindings }, 202);
});

// GET /observation/datasources — 本人スコープ一覧(V3-OBS-64)。
// 批評ゲート指摘(重大1・GATE-2026-08-01-w-obs2): "/observation/:capture_id" の
// 単一セグメントparam routeが後段(旧位置)にあると、Honoは登録順で照合するため
// "datasources" もcapture_idとして食われて到達不能になる。既存の /observation/templates
// 等と同じく、param routeより前に置く規約に合わせて移動した。
obsRoutes.get("/observation/datasources", async (c) => {
  const actorId = c.get("actorId");
  const rows = (await store(c).listEvents(`truth/${DATASOURCE_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.actor_id === actorId);
  return c.json({ datasources: rows });
});

// GET /observation/{capture_id} — detail projection: capture + photos[].
obsRoutes.get("/observation/:capture_id", async (c) => {
  const captureId = c.req.param("capture_id");
  const capture = await store(c).readEvent(`truth/${CAPTURE_TYPE}/${captureId}.json`);
  if (!capture) return c.json({ error: "NOT_FOUND" }, 404);
  const cap0 = dataOf(capture);
  // V3-OBS-54段階3/A-8-b: 非公開は未ログイン・他人には存在ごと隠す(NOT_FOUNDで統一・
  // PRIVATE_FORBIDDEN等の専用エラーにすると「存在はする」が漏れるため404で揃える)。
  if (!captureVisibleTo(cap0, c.get("actorId"))) return c.json({ error: "NOT_FOUND" }, 404);
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
  const captureId = c.req.param("capture_id");
  const photoId = c.req.param("photo_id");
  // V3-OBS-54段階3/A-8-b: 画像取得も詳細routeと同じ可視性ゲートを通す(非公開の
  // 画像だけ抜け道で見えてしまう事故を防ぐ)。
  const capture = await store(c).readEvent(`truth/${CAPTURE_TYPE}/${captureId}.json`);
  if (!capture || !captureVisibleTo(dataOf(capture), c.get("actorId"))) {
    return c.json({ error: "NOT_FOUND" }, 404);
  }
  // R65-11(公開化と同時修正・設計R0731-9c2323 §6-3/R0731-6c8982 §5-1): photo_id が
  // この capture_id のものかを検証する。未検証だと、公開 capture の id を1つ知るだけで
  // 未ログインで任意の photo_id(他の非公開 captureの写真も含む)を取得できてしまう。
  const photoEvent = await store(c).readEvent(`truth/${PHOTO_TYPE}/${captureId}-${photoId}.json`);
  if (!photoEvent) return c.json({ error: "NOT_FOUND" }, 404);
  const obj = await c.env.TRUTH.get(`media/photo/${photoId}`);
  if (!obj) return c.json({ error: "NOT_FOUND" }, 404);
  // OBS-38 低コスト改善①: 元画像も photo_id 毎に不変・URL再利用可能(重複fetch削減)。
  return new Response(await obj.arrayBuffer(), {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": `public, max-age=${MEDIA_CACHE_MAX_AGE_SEC}`,
    },
  });
});

// GET /individuals/{individual_id}/observations — captures pointing at this
// individual. ponytail: full capture-type scan + subject_ref filter, O(n);
// per-individual index is C3+ (design-c2 §3.1).
obsRoutes.get("/individuals/:individual_id/observations", async (c) => {
  const individualId = c.req.param("individual_id");
  const ref = `individual/${individualId}`;
  const actorId = c.get("actorId"); // A-8-b/AUT-15: undefined if未ログイン
  const observations = (await store(c).listEvents(`truth/${CAPTURE_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.subject_ref === ref)
    .filter((d) => captureVisibleTo(d, actorId)); // V3-OBS-54段階2
  return c.json({ individual_id: individualId, observations });
});

// GET /individuals/{individual_id}/lab-environment — chains occupancy →
// placement → lab-environment (V3-OBS-72): "where is this individual right
// now, and what does its lab actually look like" (research-room layout/HVAC
// profile), so an observation can be shown alongside the environment context
// that explains it. No open occupancy / no recorded environment → honest
// empty ({ lab_environment: null }), not 404.
obsRoutes.get("/individuals/:individual_id/lab-environment", async (c) => {
  const individualId = c.req.param("individual_id");
  const open = await projectOpenOccupancy(c.env.TRUTH, `individual/${individualId}`);
  if (!open) return c.json({ individual_id: individualId, placement_id: null, lab_environment: null });
  const lab = await projectLabEnvironmentAt(c.env.TRUTH, open.placement_id);
  return c.json({ individual_id: individualId, placement_id: open.placement_id, lab_environment: lab });
});

// V3-OBS-34: 占有(Occupancy)参照モデル — 個体ごとに環境ファイルを増殖させず、
// Specimen→Occupancy→Placement→(DeviceBinding→)Device→telemetry を結合クエリで
// 引き当てる。DeviceBinding段はOBS-17の既存の紐づけ経路(commit時body.devices・
// deriveDeviceBindingsForCapture)をそのまま再利用し、呼び出し側がdeviceIdsを渡す
// 形にする — placement→devices逆引きの新規writeパスは追加しない(既存chainの
// 読み取り再構成のみ・ファイル増殖なし)。
export async function projectEnvironmentForObservation(
  bucket: Bindings["TRUTH"],
  subjectRef: string,
  deviceIds: string[],
): Promise<{
  placement_id: string | null;
  lab_environment: Awaited<ReturnType<typeof projectLabEnvironmentAt>>;
  telemetry: Awaited<ReturnType<typeof projectTelemetryLatest>>[];
}> {
  const open = await projectOpenOccupancy(bucket, subjectRef);
  const placementId = open?.placement_id ?? null;
  const labEnvironment = placementId ? await projectLabEnvironmentAt(bucket, placementId) : null;
  const telemetry = await Promise.all(deviceIds.map((id) => projectTelemetryLatest(bucket, id)));
  return { placement_id: placementId, lab_environment: labEnvironment, telemetry };
}

// GET /observation/{capture_id}/environment — OBS-34結合投影。commit時に
// derives済みのdevices[]をcaptureから読み直し、占有→設置場所→環境+テレメトリを
// 1回のクエリで返す(個体別環境ファイルを作らない)。
obsRoutes.get("/observation/:capture_id/environment", async (c) => {
  const captureId = c.req.param("capture_id");
  const capture = await store(c).readEvent(`truth/${CAPTURE_TYPE}/${captureId}.json`);
  if (!capture) return c.json({ error: "NOT_FOUND" }, 404);
  const cap = dataOf(capture);
  const subjectRef = typeof cap.subject_ref === "string" ? cap.subject_ref : "";
  const deviceIds = Array.isArray(cap.devices) ? (cap.devices as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const env = await projectEnvironmentForObservation(c.env.TRUTH, subjectRef, deviceIds);
  return c.json({ capture_id: captureId, ...env });
});

// ── V3-OBS-69(design19 §T1-12): 観測データの統計投影 — 保存せず純関数で都度計算する
// (「自動進化エンジン」ではなく「投影による統計」と明記)。本ラウンドで実装できるのは
// 自glob内(observation*)で完結する2種類のみ:①成長率(項目の時系列傾き)②湿度・温度相関。
// ★未実装(範囲外・正直に明記): Ver別/ロット別比較はobs-capture schemaへの
// lot_id/version_id追加(bridge2-addendum・design19 §T1-7)がまだ着地していないため
// 対象フィールドが無く実装不可(bridge3待ち)。生存率は個体の生死判定(life-events)が
// w1-ind glob側の責務のため対象外(二重実装しない)。研究ギャップ検出はw-ind2側の
// KRM-15成果(ppr-cycle-node)をそのまま使う想定でここでは作らない。画面はWave4(作らない)。

/** V3-OBS-69 成長率: (最新値-最古値)/経過日数(単純線形)。2点未満・経過0日は
 *  null(推測しない・誇張ゼロ)。 */
export function projectGrowthRate(
  points: { value: number; at: string }[],
): { rate_per_day: number | null; n: number; from: string | null; to: string | null } {
  const sorted = [...points]
    .filter((p) => Number.isFinite(p.value) && !Number.isNaN(Date.parse(p.at)))
    .sort((a, b) => a.at.localeCompare(b.at));
  if (sorted.length === 0) return { rate_per_day: null, n: 0, from: null, to: null };
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (sorted.length < 2) return { rate_per_day: null, n: 1, from: first.at, to: first.at };
  const days = (Date.parse(last.at) - Date.parse(first.at)) / 86_400_000;
  if (!(days > 0)) return { rate_per_day: null, n: sorted.length, from: first.at, to: last.at };
  return { rate_per_day: (last.value - first.value) / days, n: sorted.length, from: first.at, to: last.at };
}

/** V3-OBS-69 湿度・温度相関: Pearson相関係数。n<2 または一方の分散0は null。 */
export function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const xm = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const ym = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xm;
    const dy = ys[i] - ym;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  if (dx2 === 0 || dy2 === 0) return null;
  return num / Math.sqrt(dx2 * dy2);
}

/** V3-OBS-69 Ver別/ロット別比較: captureのlot_id/version_idでitem値をグルーピングし
 *  平均を返す(比較のみ・保存しない)。lot_id/version_id未設定のcaptureは集計から
 *  除外する(欠測をでっち上げない・0扱いしない)。 */
export function groupMeanByField(
  captures: { groupKey: string | undefined; value: number | null }[],
): { group: string; mean: number; n: number }[] {
  const byGroup = new Map<string, number[]>();
  for (const { groupKey, value } of captures) {
    if (!groupKey || value === null) continue;
    (byGroup.get(groupKey) ?? byGroup.set(groupKey, []).get(groupKey)!).push(value);
  }
  return [...byGroup.entries()]
    .map(([group, values]) => ({ group, mean: values.reduce((a, b) => a + b, 0) / values.length, n: values.length }))
    .sort((a, b) => a.group.localeCompare(b.group));
}

// GET /individuals/{individual_id}/stats-projection?item=<measurement item> —
// V3-OBS-69。都度計算のみ(保存しない=不変条項①)。OBS-54可視性ゲートを一覧投影と
// 揃える(非公開captureを統計に混ぜない)。lot_id/version_idはbridge2-addendumが
// obs-capture.schema.jsonへ追加済み(本ラウンドで着地・当初はbridge3待ちだったが
// 作業中に landed したため実装した)。
obsRoutes.get("/individuals/:individual_id/stats-projection", async (c) => {
  const individualId = c.req.param("individual_id");
  const ref = `individual/${individualId}`;
  const actorId = c.get("actorId");
  const item = c.req.query("item") ?? "";
  const captures = (await store(c).listEvents(`truth/${CAPTURE_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.subject_ref === ref)
    .filter((d) => captureVisibleTo(d, actorId));

  const points: { value: number; at: string }[] = [];
  const temps: number[] = [];
  const humids: number[] = [];
  const byLot: { groupKey: string | undefined; value: number | null }[] = [];
  const byVersion: { groupKey: string | undefined; value: number | null }[] = [];
  for (const cap of captures) {
    const pc = cap.photo_conditions as Record<string, unknown> | undefined;
    const at = typeof pc?.captured_at === "string" ? pc.captured_at : String(cap.capture_id);
    const v = item ? measureValue(cap, item) : null;
    if (item && v !== null) points.push({ value: v, at });
    if (typeof pc?.temp_c === "number") temps.push(pc.temp_c);
    if (typeof pc?.humidity_pct === "number") humids.push(pc.humidity_pct);
    if (item) {
      byLot.push({ groupKey: typeof cap.lot_id === "string" ? cap.lot_id : undefined, value: v });
      byVersion.push({ groupKey: typeof cap.version_id === "string" ? cap.version_id : undefined, value: v });
    }
  }

  return c.json({
    individual_id: individualId,
    note: "投影による統計(保存せず都度計算)。生存率はw1-ind glob(life-events)側の責務のため対象外(二重実装しない)。研究ギャップ検出はw-ind2側のKRM-15成果をそのまま使う想定でここでは作らない。",
    growth_rate: item ? projectGrowthRate(points) : null,
    humidity_temp_correlation: pearsonCorrelation(temps, humids),
    lot_comparison: item ? groupMeanByField(byLot) : [],
    version_comparison: item ? groupMeanByField(byVersion) : [],
  });
});

// ── V3-OBS-64(design19 §T1-10・R64-7最小版): 外部API/センサーを domain=datasource
// のDataSourceノードとして登録・一覧・取得実行する。保存するのは method/url/interval/
// saveTo/parser/秘密でないheadersのみ。★認証情報(Authorization/APIキー/トークン)は
// 一切保存しない — ユーザーの×裁定(第20回裁定DK-1)を別名で作り直さないため、schemaの
// description記述だけでなくroute側でもハードゲートする(FORBIDDEN_HEADER_KEYS)。
// Lawノードは作らない(R64-7スコープ外)。本番cron設定(定期実行)はHQ直接の担当・
// この艦の対象外(config/consented-crons.json = 人間ゲート)。

const FORBIDDEN_HEADER_KEYS = /^(authorization|x-api-key|api-key|apikey|x-auth-token|cookie|proxy-authorization)$/i;

/** headersオブジェクトに秘密っぽいキーが1つでも含まれるか(大小無視)。 */
export function headersContainSecret(headers: unknown): boolean {
  if (typeof headers !== "object" || headers === null) return false;
  return Object.keys(headers as Record<string, unknown>).some((k) => FORBIDDEN_HEADER_KEYS.test(k));
}

// POST /observation/datasources — DataSource登録(V3-OBS-64)。
obsRoutes.post("/observation/datasources", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ error: "INVALID_BODY" }, 400);
  if (headersContainSecret(body.headers)) return c.json({ error: "SECRET_HEADER_FORBIDDEN" }, 400);
  const actorId = c.get("actorId");
  const datasourceId = ulid();
  const data: Record<string, unknown> = {
    datasource_id: datasourceId,
    actor_id: actorId,
    method: body.method,
    url: body.url,
    interval: body.interval,
    saveTo: body.saveTo,
    parser: body.parser,
    created_at: new Date().toISOString(),
  };
  if (body.headers !== undefined) data.headers = body.headers;
  const res = await store(c).putEventAt(
    `truth/${DATASOURCE_TYPE}/${datasourceId}.json`,
    envelope(DATASOURCE_TYPE, datasourceId, DATASOURCE_SCHEMA, actorId, data),
  );
  if (res.status === "invalid") return c.json({ error: "INVALID_DATASOURCE", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_DATASOURCE", key: res.key }, 409);
  return c.json({ datasource_id: datasourceId }, 201);
});

/** V3-OBS-64 取得実行(fetcher注入・テスト時は実ネットワーク非依存)。保存はcaller
 *  (route側)の責務にする — この関数はI/O結果を返すだけの薄いラッパー。 */
export async function executeDatasourceFetch(
  ds: { method: string; url: string; headers?: Record<string, string> },
  fetcher: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    const res = await fetcher(ds.url, { method: ds.method, headers: ds.headers });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: e instanceof Error ? e.message : "fetch_failed" };
  }
}

// POST /observation/datasources/{id}/execute — 1回分の取得実行(V3-OBS-64)。本番cronの
// 定期実行配線はHQ担当(対象外)だが、cronが呼び出す実行本体はここに実装しておく
// (「公開APIを1本登録し、cronがintervalで取得してsaveToに保存できる」の完了条件を
// 満たす土台)。結果は saveTo プレフィクス配下へ生バイト列のまま保存する(パース処理
// parser識別子ごとの分岐は本最小版では未実装=正直に明記)。
obsRoutes.post("/observation/datasources/:id/execute", async (c) => {
  const dsId = c.req.param("id");
  const actorId = c.get("actorId");
  const rec = await store(c).readEvent(`truth/${DATASOURCE_TYPE}/${dsId}.json`);
  if (!rec) return c.json({ error: "NOT_FOUND" }, 404);
  const d = dataOf(rec);
  if (d.actor_id !== actorId) return c.json({ error: "NOT_FOUND" }, 404);
  const result = await executeDatasourceFetch({
    method: String(d.method),
    url: String(d.url),
    headers: (d.headers ?? undefined) as Record<string, string> | undefined,
  });
  const saveTo = String(d.saveTo);
  const savedKey = result.ok ? `${saveTo}/${dsId}-${new Date().toISOString()}.json` : null;
  if (savedKey) await store(c).putBlob(savedKey, new TextEncoder().encode(result.body), "application/json");
  return c.json({ datasource_id: dsId, ok: result.ok, status: result.status, saved_key: savedKey });
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

// Last-observation prefill for an individual (棚→個体→種→前回テンプレ連鎖・
// OBS-20). Shared by both QR flavors below so the chain is defined exactly once.
async function buildIndividualPrefill(
  st: TruthStore,
  individualId: string,
): Promise<{ template_id: unknown; species_candidate: unknown; measurements: unknown } | null> {
  const ref = `individual/${individualId}`;
  const caps = (await st.listEvents(`truth/${CAPTURE_TYPE}/`))
    .map(dataOf)
    .filter((x) => x.subject_ref === ref)
    .sort((a, b) => String(a.capture_id).localeCompare(String(b.capture_id)));
  const last = caps[caps.length - 1];
  return last
    ? {
        template_id: last.template_id ?? null,
        species_candidate: last.species_candidate ?? null,
        measurements: last.measurements ?? [],
      }
    : null;
}

// GET /qr/{token} — resolve token → { individual_id } (observation re-entry).
// With ?prefill=1 (OBS-20): also returns entry_mode=qr + last-observation prefill
// (棚→個体→種→テンプレ連鎖) so the QR-resume form starts pre-filled. The bare
// call keeps its original { individual_id } shape (existing contract).
//
// A token not found in the individual-QR store (ihl.ind.qr.v1) also falls back
// to the placement/shelf-QR store (ihl.env.qr.v1, source-routes.ts POST
// /placements/:id/qr — CL-10 env_qr_token_v1 shape): a shelf label resolves to
// whichever individual(s) currently occupy it (projectOccupantsAt). No current
// occupant (empty shelf) still resolves (individual_id: null,
// entry_mode: qr_placement_empty) rather than 404 — the shelf is still
// scannable to start a brand-new individual there. Exactly one occupant keeps
// the original entry_mode: qr_placement + prefill chain. 2+ occupants (a shelf
// holding multiple adults — persona R75) is entry_mode: qr_placement_multi
// with an `occupants` list the user must pick from (OBS wave1 R2).
obsRoutes.get("/qr/:token", async (c) => {
  const token = c.req.param("token");
  const st = store(c);

  const ev = await st.readEvent(`truth/${QR_TYPE}/${token}.json`);
  if (ev) {
    const d = dataOf(ev);
    if (typeof d.expires_at === "string" && Date.parse(d.expires_at) < Date.now()) {
      return c.json({ error: "QR_EXPIRED" }, 410);
    }
    if (!c.req.query("prefill")) return c.json({ individual_id: d.individual_id });
    const prefill = await buildIndividualPrefill(st, String(d.individual_id));
    return c.json({ individual_id: d.individual_id, entry_mode: "qr", prefill });
  }

  const envEv = await st.readEvent(`truth/${ENV_QR_TYPE}/${token}.json`);
  if (!envEv) return c.json({ error: "NOT_FOUND" }, 404);
  const ed = dataOf(envEv);
  if (typeof ed.expires_at === "string" && Date.parse(ed.expires_at) < Date.now()) {
    return c.json({ error: "QR_EXPIRED" }, 410);
  }
  const placementId = String(ed.placement_id);
  // V3-OBS-2x (OBS wave1 R2・persona R75): a shelf can hold multiple adults at
  // once — resolve ALL current occupants first and only collapse to a single
  // individual_id when there is exactly one, matching the pre-existing
  // occupied/empty contract exactly. 2+ occupants is a NEW branch (below) the
  // user must pick from; it does not change the 0/1 shapes at all.
  const occupants = (await projectOccupantsAt(c.env.TRUTH, placementId)).filter((o) =>
    o.subject_ref.startsWith("individual/"),
  );
  if (occupants.length >= 2) {
    if (!c.req.query("prefill")) return c.json({ placement_id: placementId, individual_id: null });
    const rows = await Promise.all(
      occupants.map((o) => projectIndividualSummary(st, o.subject_ref.slice("individual/".length))),
    );
    return c.json({
      placement_id: placementId,
      individual_id: null,
      entry_mode: "qr_placement_multi",
      occupants: rows,
    });
  }
  const individualId = occupants.length === 1 ? occupants[0].subject_ref.slice("individual/".length) : null;
  if (!c.req.query("prefill")) return c.json({ placement_id: placementId, individual_id: individualId });
  const prefill = individualId ? await buildIndividualPrefill(st, individualId) : null;
  return c.json({
    placement_id: placementId,
    individual_id: individualId,
    entry_mode: individualId ? "qr_placement" : "qr_placement_empty",
    prefill,
  });
});
