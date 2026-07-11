// C5 K1 種/形態 API (design-k1 §1.1 / V3-IND-19). All routes PROTECTED. Writes
// stamp data.actor_id from the session principal (V3-AUT-17). species/morph are
// put-if-absent (409 on duplicate id). Stats + alias candidates are recomputed on
// read (invariant ①). alias统合 is human-approved only (approveAlias); the machine
// only PROPOSES candidates (aliasCandidates) — never auto-merges (invariant ④).
// envelope()/store()/dataOf() inlined per the projectLedger precedent (批評家#3).
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";

export const taxonRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const SPECIES_TYPE = "ihl.taxon.species.v1";
const MORPH_TYPE = "ihl.taxon.morph.v1";
const ALIAS_TYPE = "ihl.taxon.alias.v1";
const CAPTURE_TYPE = "ihl.obs.capture.v1"; // read-only (observation package)

const SCHEMA = {
  species: "schemas/events/taxon-species.schema.json",
  morph: "schemas/events/taxon-morph.schema.json",
  alias: "schemas/events/taxon-alias.schema.json",
} as const;

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

const nowIso = () => new Date().toISOString();

// ── projections ────────────────────────────────────────────────────────────────

function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/**
 * Species stats recomputed from captures (avg size/weight over captures whose
 * species_candidate = speciesId). avg_market_price is null: mkt-listing carries
 * no species reference yet (join is a later 波 · design §1.4 note). Deterministic.
 */
export async function projectSpeciesStats(s: TruthStore, speciesId: string) {
  const caps = (await s.listEvents(`truth/${CAPTURE_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.species_candidate === speciesId);
  const lengths: number[] = [];
  const weights: number[] = [];
  for (const cap of caps) {
    const ms = Array.isArray(cap.measurements) ? (cap.measurements as Record<string, unknown>[]) : [];
    for (const m of ms) {
      if (typeof m.value !== "number") continue;
      if (m.item === "length") lengths.push(m.value);
      else if (m.item === "weight") weights.push(m.value);
    }
  }
  return {
    species_id: speciesId,
    sample_count: caps.length,
    avg_size: avg(lengths),
    avg_weight: avg(weights),
    avg_market_price: null as number | null, // ponytail: mkt-listing has no species ref yet
  };
}

// ── deterministic string similarity (no deps · ~40 lines · embedding sim OFF §5) ─
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

function jaro(a: string, b: string): number {
  if (a === b) return 1;
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;
  const window = Math.max(0, Math.floor(Math.max(m, n) / 2) - 1);
  const aMatch = new Array(m).fill(false);
  const bMatch = new Array(n).fill(false);
  let matches = 0;
  for (let i = 0; i < m; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(i + window + 1, n);
    for (let j = lo; j < hi; j++) {
      if (bMatch[j] || a[i] !== b[j]) continue;
      aMatch[i] = true;
      bMatch[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < m; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  t /= 2;
  return (matches / m + matches / n + (matches - t) / matches) / 3;
}

function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  return j + prefix * 0.1 * (1 - j);
}

/**
 * Alias candidates: mean of normalized Levenshtein similarity and Jaro-Winkler,
 * sorted desc. Pure, deterministic — proposes only; approveAlias does the merge
 * (invariant ④). embedding-similarity alias detection is OFF by default (§5 defer).
 */
export function aliasCandidates(
  name: string,
  existing: { species_id: string; name: string }[],
): { species_id: string; name: string; score: number }[] {
  const q = name.toLowerCase();
  return existing
    .map((e) => {
      const t = String(e.name).toLowerCase();
      const maxLen = Math.max(q.length, t.length) || 1;
      const levSim = 1 - levenshtein(q, t) / maxLen;
      const score = (levSim + jaroWinkler(q, t)) / 2;
      return { species_id: e.species_id, name: e.name, score };
    })
    .sort((a, b) => b.score - a.score || String(a.species_id).localeCompare(String(b.species_id)));
}

// ── routes ───────────────────────────────────────────────────────────────────

// POST /species — create a species master (put-if-absent 409 · fork via forked_from).
taxonRoutes.post("/species", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");
  const speciesId = typeof body.species_id === "string" && body.species_id ? body.species_id : ulid();
  const data: Record<string, unknown> = { species_id: speciesId, name: body.name, actor_id: actorId, created_at: nowIso() };
  for (const k of ["lineage", "forked_from"] as const) if (typeof body[k] === "string") data[k] = body[k];
  const res = await store(c).putEventAt(
    `truth/${SPECIES_TYPE}/${speciesId}.json`,
    envelope(SPECIES_TYPE, SCHEMA.species, actorId, data),
  );
  if (res.status === "invalid") return c.json({ error: "INVALID_SPECIES", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_SPECIES", key: res.key }, 409);
  return c.json({ species_id: speciesId }, 201);
});

// GET /species — list masters + auto-computed stats per species.
// ponytail: O(species × captures) recompute; a stats index is a later rung if n grows.
taxonRoutes.get("/species", async (c) => {
  const s = store(c);
  const masters = (await s.listEvents(`truth/${SPECIES_TYPE}/`)).map(dataOf);
  const species = [];
  for (const m of masters) {
    const stats = await projectSpeciesStats(s, String(m.species_id));
    species.push({ ...m, stats });
  }
  return c.json({ species });
});

// GET /species/alias-candidates?name= — deterministic similarity proposals.
// MUST be registered before /species/:id (static beats param in registration order).
taxonRoutes.get("/species/alias-candidates", async (c) => {
  const name = c.req.query("name") ?? "";
  const existing = (await store(c).listEvents(`truth/${SPECIES_TYPE}/`))
    .map(dataOf)
    .map((d) => ({ species_id: String(d.species_id), name: String(d.name ?? "") }));
  return c.json({ name, candidates: aliasCandidates(name, existing).slice(0, 5) });
});

// GET /species/{id} — master + auto-computed stats (avg size/weight/market price).
taxonRoutes.get("/species/:id", async (c) => {
  const id = c.req.param("id");
  const s = store(c);
  const master = await s.readEvent(`truth/${SPECIES_TYPE}/${id}.json`);
  if (!master) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json({ species: dataOf(master), stats: await projectSpeciesStats(s, id) });
});

// POST /morphs — create a morph master (put-if-absent 409 · fork via forked_from).
taxonRoutes.post("/morphs", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");
  const morphId = typeof body.morph_id === "string" && body.morph_id ? body.morph_id : ulid();
  const data: Record<string, unknown> = {
    morph_id: morphId,
    species_id: body.species_id,
    name: body.name,
    actor_id: actorId,
    created_at: nowIso(),
  };
  if (typeof body.forked_from === "string") data.forked_from = body.forked_from;
  const res = await store(c).putEventAt(
    `truth/${MORPH_TYPE}/${morphId}.json`,
    envelope(MORPH_TYPE, SCHEMA.morph, actorId, data),
  );
  if (res.status === "invalid") return c.json({ error: "INVALID_MORPH", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_MORPH", key: res.key }, 409);
  return c.json({ morph_id: morphId }, 201);
});

// POST /species/aliases — merge an alias AFTER human approval (approved_by required
// by schema). The candidate proposer (alias-candidates) never writes this.
taxonRoutes.post("/species/aliases", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");
  const aliasId = typeof body.alias_id === "string" && body.alias_id ? body.alias_id : ulid();
  const data: Record<string, unknown> = {
    alias_id: aliasId,
    canonical_species_id: body.canonical_species_id,
    alias_text: body.alias_text,
    approved_by: body.approved_by,
    actor_id: actorId,
    created_at: nowIso(),
  };
  const res = await store(c).putEventAt(
    `truth/${ALIAS_TYPE}/${aliasId}.json`,
    envelope(ALIAS_TYPE, SCHEMA.alias, actorId, data),
  );
  if (res.status === "invalid") return c.json({ error: "INVALID_ALIAS", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_ALIAS", key: res.key }, 409);
  return c.json({ alias_id: aliasId }, 201);
});
