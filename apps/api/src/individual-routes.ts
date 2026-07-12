// C5 K1 個体系 API (design-k1 §1.1 / V3-IND-01/02/04/12/13/15/21). All routes
// PROTECTED — index.ts §1.5 gates them and sets actorId. Every write stamps
// data.actor_id from the session principal (V3-AUT-17): a body-supplied actor_id
// is ignored, never trusted. Truth is INSERT ONLY (put-if-absent 409). Every
// projection is recomputed on read from Truth — no resident DB (invariant ①).
//
// envelope()/store()/dataOf() are re-declared inline here (they are module-private
// in observation-routes.ts / ledger-routes.ts and cannot be imported — same
// precedent as projectLedger's inline helpers · 批評家#3).
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { QR_BATCH_SIZES } from "./observation-constants";

export const individualRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── event type strings (underscore per envelope type pattern) + dataschema refs ─
const MASTER_TYPE = "ihl.ind.master.v1";
const CROSS_TYPE = "ihl.ind.cross_parent.v1";
const NAME_TYPE = "ihl.ind.name_event.v1";
const BRAND_TYPE = "ihl.ind.brand_template.v1";
const LIFE_TYPE = "ihl.ind.life_event.v1";
// cross-module read-only types (owned by observation / market packages).
const CAPTURE_TYPE = "ihl.obs.capture.v1";
const PHOTO_TYPE = "ihl.obs.photo.v1";
const SCHEDULE_TYPE = "ihl.obs.schedule.v1";
const DEVICE_TYPE = "ihl.obs.device.v1";

const SCHEMA = {
  master: "schemas/events/ind-master.schema.json",
  cross: "schemas/events/ind-cross-parent.schema.json",
  name: "schemas/events/ind-name-event.schema.json",
  brand: "schemas/events/ind-brand-template.schema.json",
  life: "schemas/events/ind-life-event.schema.json",
} as const;

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}

function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

function idOf(e: Record<string, unknown>): string {
  return typeof e.id === "string" ? e.id : "";
}

function envelope(
  type: string,
  dataschema: string,
  actorId: string,
  data: Record<string, unknown>,
) {
  return {
    specversion: "1.0",
    id: ulid(), // CloudEvents id stays a ULID; the Truth key carries the domain layout.
    source: "apps/api",
    type,
    time: new Date().toISOString(),
    dataschema,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}

const nowIso = () => new Date().toISOString();

// ── projections (pure · recomputed on read · Truth-schema only · D7) ───────────

export interface PedigreeNode {
  individual_id: string;
  known: boolean; // a master record exists for this id
  parent_role?: "sire" | "dam" | "surrogate";
  circular?: boolean; // ancestry cycle cut here (visited already)
  truncated?: boolean; // maxDepth reached
  parents: PedigreeNode[];
}

/**
 * Multi-generation pedigree tree from ihl.ind.cross_parent.v1 (blood Truth,
 * ADR-H-11). A missing parent (no master record) → { known:false } leaf. A
 * visited id (cycle) → { circular:true } leaf so a self-referential lineage
 * cannot infinite-loop. maxDepth bounds the walk.
 */
export async function buildPedigree(
  s: TruthStore,
  individualId: string,
  maxDepth = 6,
): Promise<PedigreeNode> {
  const visited = new Set<string>();
  const walk = async (id: string, depth: number): Promise<PedigreeNode> => {
    const known = !!(await s.readEvent(`truth/${MASTER_TYPE}/${id}.json`));
    if (visited.has(id)) return { individual_id: id, known, circular: true, parents: [] };
    visited.add(id);
    if (!known) return { individual_id: id, known: false, parents: [] };
    if (depth >= maxDepth) return { individual_id: id, known, truncated: true, parents: [] };
    const links = (await s.listEvents(`truth/${CROSS_TYPE}/${id}-`))
      .map(dataOf)
      .filter((d) => d.child_id === id)
      .sort((a, b) => String(a.parent_role).localeCompare(String(b.parent_role)));
    const parents: PedigreeNode[] = [];
    for (const l of links) {
      const node = await walk(String(l.parent_id), depth + 1);
      parents.push({ ...node, parent_role: l.parent_role as PedigreeNode["parent_role"] });
    }
    return { individual_id: id, known, parents };
  };
  return walk(individualId, 0);
}

/** Current display name (or name at `at` — the last rename on/before that time). */
export async function projectName(
  s: TruthStore,
  id: string,
  at?: string,
): Promise<string | null> {
  const rows = (await s.listEvents(`truth/${NAME_TYPE}/${id}-`))
    .filter((e) => dataOf(e).individual_id === id)
    .map((e) => ({
      ev: idOf(e),
      name: String(dataOf(e).name ?? ""),
      created_at: String(dataOf(e).created_at ?? ""),
    }))
    .filter((r) => !at || r.created_at <= at)
    // deterministic: created_at asc, ULID tie-break (name events share a ms).
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.ev.localeCompare(b.ev));
  return rows.length ? rows[rows.length - 1].name : null;
}

/**
 * Whole-individual projection: master + current name + timeline (life-events
 * sorted birth→…→specimen) + the 6 culture blocks (IND-13). observations join by
 * subject_ref; the other blocks join where the substrate carries a link and are
 * [] otherwise (market listings carry no individual ref yet — later 波).
 */
export async function projectIndividual(s: TruthStore, id: string) {
  const master = await s.readEvent(`truth/${MASTER_TYPE}/${id}.json`);
  const ref = `individual/${id}`;
  const life = (await s.listEvents(`truth/${LIFE_TYPE}/${id}-`))
    .map(dataOf)
    .filter((d) => d.individual_id === id);
  const observations = (await s.listEvents(`truth/${CAPTURE_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.subject_ref === ref);
  // An individual is implicit (不変条項① 派生値は投影で都度再計算): it exists as
  // soon as anything references it — a capture's subject_ref or a life-event —
  // even with no explicit master record (the observation flow never mints one).
  // 404 stays reserved for a genuinely unknown id (no master, no derived refs).
  if (!master && observations.length === 0 && life.length === 0) return null;
  const timeline = life.slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const schedules = (await s.listEvents(`truth/${SCHEDULE_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.individual_id === id);
  const data_sources = (await s.listEvents(`truth/${DEVICE_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.placement_ref === ref);
  const templates = [
    ...new Set(observations.map((o) => o.template_id).filter((x): x is string => typeof x === "string")),
  ];
  return {
    individual_id: id,
    master: master ? dataOf(master) : null,
    name: await projectName(s, id),
    timeline,
    // 6 文化ブロック: 観測履歴 / スケジュール / テンプレ / DataSource=device / 市場オファー / 改善
    observations,
    schedules,
    templates,
    data_sources,
    market_offers: [] as Record<string, unknown>[], // ponytail: mkt-listing has no individual ref yet; join is a later 波
    improvements: [] as Record<string, unknown>[], // fork/improvement lineage is a later 波
  };
}

// offspring cohort: distinct children where `id` is a recorded parent.
async function offspringOf(s: TruthStore, id: string): Promise<string[]> {
  const kids = (await s.listEvents(`truth/${CROSS_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.parent_id === id)
    .map((d) => String(d.child_id));
  return [...new Set(kids)].sort();
}

const rate = (num: number, den: number): number => (den > 0 ? num / den : 0);

function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/**
 * Breeding cross results for an individual viewed as a parent: deterministic
 * rate cards over its offspring cohort + weight-by-instar / size extremes from
 * cohort captures. `metric` returns a single rate card. Color reproducibility
 * needs color analysis (§5 defer) → null. Deterministic: pure function of Truth.
 */
export async function projectCross(s: TruthStore, id: string, metric?: string) {
  const children = await offspringOf(s, id);
  const total = children.length;
  const childSet = new Set(children);

  let deaths = 0;
  let eclosions = 0;
  let eclosionFailures = 0;
  let births = 0;
  let males = 0;
  let females = 0;
  for (const cid of children) {
    const les = (await s.listEvents(`truth/${LIFE_TYPE}/${cid}-`))
      .map(dataOf)
      .filter((d) => d.individual_id === cid);
    if (les.some((e) => e.kind === "death")) deaths++;
    const ecl = les.filter((e) => e.kind === "eclosion");
    if (ecl.length) eclosions++;
    if (ecl.some((e) => (e.detail as Record<string, unknown> | undefined)?.success === false)) {
      eclosionFailures++;
    }
    if (les.some((e) => e.kind === "birth")) births++;
    for (const e of les) {
      const sx = (e.detail as Record<string, unknown> | undefined)?.sex;
      if (sx === "male") males++;
      else if (sx === "female") females++;
    }
  }

  // cohort captures → weight by instar / size extremes.
  const caps = (await s.listEvents(`truth/${CAPTURE_TYPE}/`))
    .map(dataOf)
    .filter((d) => {
      const ref = typeof d.subject_ref === "string" ? d.subject_ref : "";
      return ref.startsWith("individual/") && childSet.has(ref.slice("individual/".length));
    });
  const instarWeights: Record<string, number[]> = {
    first: [],
    second: [],
    third_early: [],
    third_late: [],
  };
  const weights: number[] = [];
  const lengths: number[] = [];
  for (const cap of caps) {
    const ms = Array.isArray(cap.measurements) ? (cap.measurements as Record<string, unknown>[]) : [];
    for (const m of ms) {
      if (typeof m.value !== "number") continue;
      if (m.item === "weight") {
        weights.push(m.value);
        const instar = typeof m.instar === "string" ? m.instar : undefined;
        if (instar && instar in instarWeights) instarWeights[instar].push(m.value);
      } else if (m.item === "length") {
        lengths.push(m.value);
      }
    }
  }

  const rates = {
    mortality: rate(deaths, total),
    survival: total > 0 ? 1 - rate(deaths, total) : 0,
    completion: rate(eclosions - eclosionFailures, total), // 完品率 = 無事羽化 / 総数
    eclosion_failure: rate(eclosionFailures, total), // 羽化不全率
    hatch_rate: rate(births, total), // 孵化率
    sex_ratio: males + females > 0 ? males / (males + females) : null, // 性比(雄比)
    color_reproducibility: null as number | null, // §5 defer(色解析後波)
  };
  if (metric) {
    if (!(metric in rates)) return { individual_id: id, metric, value: null, unknown_metric: true };
    return { individual_id: id, metric, value: (rates as Record<string, number | null>)[metric] };
  }
  return {
    individual_id: id,
    cohort_size: total,
    weight_by_instar: {
      first: avg(instarWeights.first),
      second: avg(instarWeights.second),
      third_early: avg(instarWeights.third_early),
      third_late: avg(instarWeights.third_late),
    },
    size_extremes: {
      max_weight: weights.length ? Math.max(...weights) : null,
      max_length: lengths.length ? Math.max(...lengths) : null,
      min_length: lengths.length ? Math.min(...lengths) : null,
    },
    rates,
  };
}

/** Name-card facts: species / morph / latest size / feature tags / QR URL (IND-15). */
export async function projectBioCard(s: TruthStore, id: string) {
  const master = await s.readEvent(`truth/${MASTER_TYPE}/${id}.json`);
  if (!master) return null;
  const m = dataOf(master);
  const ref = `individual/${id}`;
  const caps = (await s.listEvents(`truth/${CAPTURE_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.subject_ref === ref)
    .sort((a, b) => String(a.capture_id).localeCompare(String(b.capture_id))); // ULID = time order
  const latest = caps[caps.length - 1];
  const latestSize = latest ? latestMeasure(latest, "length") ?? latestMeasure(latest, "weight") : null;
  return {
    individual_id: id,
    species: typeof m.species === "string" ? m.species : null,
    morph: null as string | null, // morph link is a later 波(taxon.morph is a master, not yet individual-linked)
    latest_size: latestSize,
    feature_tags: [] as string[], // tag layer is P4; empty until joined
    qr_url: `/individuals/${id}`, // QR content = the individual URL (IND-15)
  };
}

function latestMeasure(cap: Record<string, unknown>, item: string): number | null {
  const ms = Array.isArray(cap.measurements) ? (cap.measurements as Record<string, unknown>[]) : [];
  for (const m of ms) if (m.item === item && typeof m.value === "number") return m.value;
  return null;
}

/**
 * Authenticity: continuity evidence (image sha256 chain / observation presence /
 * growth monotonicity) → 0..1 score, registered-vs-evidenced reconciliation, and
 * lineage-contradiction detection (self-parent / ancestry cycle — a genuine blood
 * contradiction detectable from Truth; listing-text conflict is a later 波). IND-21.
 */
export async function projectAuthenticity(s: TruthStore, id: string) {
  const master = await s.readEvent(`truth/${MASTER_TYPE}/${id}.json`);
  if (!master) return null;
  const ref = `individual/${id}`;
  const caps = (await s.listEvents(`truth/${CAPTURE_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.subject_ref === ref)
    .sort((a, b) => String(a.capture_id).localeCompare(String(b.capture_id)));

  // image sha256 chain: every photo of every observation carries a sha256.
  let photoCount = 0;
  let photoWithSha = 0;
  for (const cap of caps) {
    const photos = (await s.listEvents(`truth/${PHOTO_TYPE}/${cap.capture_id}-`)).map(dataOf);
    for (const p of photos) {
      photoCount++;
      if (typeof p.sha256 === "string" && p.sha256) photoWithSha++;
    }
  }

  // growth monotonicity: weights ordered by capture time non-decreasing.
  const weightSeries: number[] = [];
  for (const cap of caps) {
    const w = latestMeasure(cap, "weight");
    if (w !== null) weightSeries.push(w);
  }
  let growthMonotonic = true;
  for (let i = 1; i < weightSeries.length; i++) {
    if (weightSeries[i] < weightSeries[i - 1]) growthMonotonic = false;
  }

  const life = (await s.listEvents(`truth/${LIFE_TYPE}/${id}-`))
    .map(dataOf)
    .filter((d) => d.individual_id === id);

  // lineage contradictions from blood Truth.
  const conflicts: { type: string; detail?: string }[] = [];
  const links = (await s.listEvents(`truth/${CROSS_TYPE}/${id}-`)).map(dataOf).filter((d) => d.child_id === id);
  for (const l of links) if (l.parent_id === id) conflicts.push({ type: "self_parent" });
  const hasCircular = (n: PedigreeNode): boolean =>
    n.circular === true || n.parents.some(hasCircular);
  if (hasCircular(await buildPedigree(s, id))) conflicts.push({ type: "circular_ancestry" });

  // 4 quarter-signals → 0..1 continuity score.
  const sig = [
    true, // master exists (else 404)
    caps.length > 0, // observed
    photoCount > 0 && photoWithSha === photoCount, // full image chain
    growthMonotonic, // monotone growth
  ].filter(Boolean).length;

  return {
    individual_id: id,
    continuity_score: sig / 4,
    image_chain: { photos: photoCount, with_sha256: photoWithSha, intact: photoCount > 0 && photoWithSha === photoCount },
    growth_monotonic: growthMonotonic,
    // 登録数 vs 実在数: recorded life milestones vs observed evidence.
    registration: {
      registered_events: life.length,
      evidenced_observations: caps.length,
      consistent: caps.length > 0 || life.length === 0,
    },
    lineage_conflicts: conflicts,
  };
}

// ── routes ────────────────────────────────────────────────────────────────────

// POST /individuals — create a master record (no growth fields · IND-02).
// individual_id: client MAY supply (idempotency → 409); else generated.
individualRoutes.post("/individuals", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");
  const individualId =
    typeof body.individual_id === "string" && body.individual_id ? body.individual_id : ulid();
  const data: Record<string, unknown> = {
    individual_id: individualId,
    actor_id: actorId,
    created_at: nowIso(),
  };
  for (const k of ["local_label_text", "species", "birth_or_hatch_date", "source_type"] as const) {
    if (body[k] !== undefined) data[k] = body[k];
  }
  const res = await store(c).putEventAt(
    `truth/${MASTER_TYPE}/${individualId}.json`,
    envelope(MASTER_TYPE, SCHEMA.master, actorId, data),
  );
  if (res.status === "invalid") return c.json({ error: "INVALID_INDIVIDUAL", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_INDIVIDUAL", key: res.key }, 409);
  return c.json({ individual_id: individualId }, 201);
});

// GET /individuals?q= — 本人の個体一覧/検索(V3-AIP-101 観測登録スライス1 F1).
// q が local_label_text/name/species の部分一致(大小無視)に当たる個体のみ返す。
// q なしは本人の全件。label は local_label_text→name→id の優先で埋める。
// ponytail: O(n) full master scan + 該当件のみ projectName、per-actor index は
// 在庫が伸びたら昇格(既存 /observation/search 前例と同じ縮退)。
individualRoutes.get("/individuals", async (c) => {
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const actorId = c.get("actorId");
  const s = store(c);
  const masters = (await s.listEvents(`truth/${MASTER_TYPE}/`))
    .map(dataOf)
    .filter((m) => m.actor_id === actorId);
  const individuals: Record<string, unknown>[] = [];
  for (const m of masters) {
    const id = String(m.individual_id ?? "");
    if (!id) continue;
    const label = typeof m.local_label_text === "string" ? m.local_label_text : "";
    const species = typeof m.species === "string" ? m.species : "";
    const name = await projectName(s, id);
    if (q && ![label, species, name ?? ""].some((v) => v.toLowerCase().includes(q))) continue;
    individuals.push({ individual_id: id, label: label || name || id, name, species: species || null });
  }
  individuals.sort((a, b) => String(a.individual_id).localeCompare(String(b.individual_id)));
  return c.json({ individuals });
});

// GET /individuals/{id} — whole-individual projection (6 文化 + timeline · IND-13).
individualRoutes.get("/individuals/:id", async (c) => {
  const proj = await projectIndividual(store(c), c.req.param("id"));
  if (!proj) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json(proj);
});

// POST /individuals/{id}/parents — append a blood link (IND-01/12). Key by
// (child,role) → re-adding the same role is a 409, sire/dam/surrogate coexist.
individualRoutes.post("/individuals/:id/parents", async (c) => {
  const childId = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");
  const role = body.parent_role;
  const data: Record<string, unknown> = {
    child_id: childId,
    parent_id: body.parent_id,
    parent_role: role,
    actor_id: actorId,
    created_at: nowIso(),
  };
  const res = await store(c).putEventAt(
    `truth/${CROSS_TYPE}/${childId}-${String(role)}.json`,
    envelope(CROSS_TYPE, SCHEMA.cross, actorId, data),
  );
  if (res.status === "invalid") return c.json({ error: "INVALID_PARENT", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_PARENT", key: res.key }, 409);
  return c.json({ child_id: childId, parent_role: role }, 201);
});

// GET /individuals/{id}/pedigree — multi-generation tree (IND-01).
individualRoutes.get("/individuals/:id/pedigree", async (c) => {
  return c.json(await buildPedigree(store(c), c.req.param("id")));
});

// GET /individuals/{id}/cross — cross-result rate cards; ?metric= swaps to one
// card (IND-12). Only reachable per-individual (no home-level /cross route).
individualRoutes.get("/individuals/:id/cross", async (c) => {
  const metric = c.req.query("metric");
  return c.json(await projectCross(store(c), c.req.param("id"), metric));
});

// POST /individuals/{id}/name — append a rename (IND-04). created_at optional
// (back-dating a historical name); default now.
individualRoutes.post("/individuals/:id/name", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");
  const data: Record<string, unknown> = {
    individual_id: id,
    name: body.name,
    actor_id: actorId,
    created_at: typeof body.created_at === "string" ? body.created_at : nowIso(),
  };
  if (typeof body.brand_template_id === "string") data.brand_template_id = body.brand_template_id;
  const res = await store(c).putEventAt(
    `truth/${NAME_TYPE}/${id}-${ulid()}.json`,
    envelope(NAME_TYPE, SCHEMA.name, actorId, data),
  );
  if (res.status === "invalid") return c.json({ error: "INVALID_NAME", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_NAME", key: res.key }, 409);
  return c.json({ individual_id: id, name: body.name }, 201);
});

// GET /individuals/{id}/name — current name, or ?at=ISO for the name at that time.
individualRoutes.get("/individuals/:id/name", async (c) => {
  const id = c.req.param("id");
  const at = c.req.query("at");
  return c.json({ individual_id: id, name: await projectName(store(c), id, at), at: at ?? null });
});

// POST /brand-templates — append a naming template (active=false = logical delete
// as a NEW record · IND-04).
individualRoutes.post("/brand-templates", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");
  const brandId =
    typeof body.brand_template_id === "string" && body.brand_template_id ? body.brand_template_id : ulid();
  const data: Record<string, unknown> = {
    brand_template_id: brandId,
    pattern: body.pattern,
    active: body.active === undefined ? true : body.active,
    actor_id: actorId,
    created_at: nowIso(),
  };
  const res = await store(c).putEventAt(
    `truth/${BRAND_TYPE}/${brandId}-${ulid()}.json`,
    envelope(BRAND_TYPE, SCHEMA.brand, actorId, data),
  );
  if (res.status === "invalid") return c.json({ error: "INVALID_BRAND_TEMPLATE", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_BRAND_TEMPLATE", key: res.key }, 409);
  return c.json({ brand_template_id: brandId, active: data.active }, 201);
});

// GET /individuals/{id}/bio-card — name-card facts + QR URL (IND-15).
individualRoutes.get("/individuals/:id/bio-card", async (c) => {
  const card = await projectBioCard(store(c), c.req.param("id"));
  if (!card) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json(card);
});

// POST /individuals/qr-batch — issue a run of blank QR labels as URLs (IND-15).
// count ∈ {100,500,1000} only. ponytail: labels are unbound blank URLs; binding
// to a real individual happens on first scan — pre-persisting N masters is waste.
// Physical print alignment (91×55mm) is a human gate (§5), not this route.
individualRoutes.post("/individuals/qr-batch", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const count = Number(body.count);
  if (!(QR_BATCH_SIZES as readonly number[]).includes(count)) {
    return c.json({ error: "INVALID_BATCH_SIZE", allowed: QR_BATCH_SIZES }, 400);
  }
  const urls = Array.from({ length: count }, () => `/individuals/${ulid()}`);
  return c.json({ count, urls }, 201);
});

// GET /individuals/{id}/authenticity — continuity + lineage-conflict score (IND-21).
individualRoutes.get("/individuals/:id/authenticity", async (c) => {
  const auth = await projectAuthenticity(store(c), c.req.param("id"));
  if (!auth) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json(auth);
});

// POST /individuals/{id}/life-events — append a life milestone (IND-12/13).
individualRoutes.post("/individuals/:id/life-events", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");
  const data: Record<string, unknown> = {
    individual_id: id,
    kind: body.kind,
    at: body.at,
    actor_id: actorId,
    created_at: nowIso(),
  };
  if (body.detail !== undefined) data.detail = body.detail;
  const res = await store(c).putEventAt(
    `truth/${LIFE_TYPE}/${id}-${ulid()}.json`,
    envelope(LIFE_TYPE, SCHEMA.life, actorId, data),
  );
  if (res.status === "invalid") return c.json({ error: "INVALID_LIFE_EVENT", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_LIFE_EVENT", key: res.key }, 409);
  return c.json({ individual_id: id, kind: body.kind }, 201);
});
