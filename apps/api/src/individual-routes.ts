// C5 K1 個体系 API (design-k1 §1.1 / V3-IND-01/02/04/12/13/15/21). All routes
// PROTECTED — index.ts §1.5 gates them and sets actorId. Every write stamps
// data.actor_id from the session principal (V3-AUT-17): a body-supplied actor_id
// is ignored, never trusted. Truth is INSERT ONLY (put-if-absent 409). Every
// projection is recomputed on read from Truth — no resident DB (invariant ①).
//
// envelope()/store()/dataOf() are re-declared inline here (they are module-private
// in observation-routes.ts / ledger-routes.ts and cannot be imported — same
// precedent as projectLedger's inline helpers · 批評家#3).
import { Hono, type Context } from "hono";
import { TruthStore, ulid, cosineSimilarity, type R2BucketLite } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { QR_BATCH_SIZES, STAGE_TO_NEXT_TRANSITION } from "./observation-constants";
import { appendContribution } from "./contribution";
import { CONTRIB_INDIVIDUAL_CREATED } from "./economy-constants";
import { projectOpenBindings, projectCurrentOwner } from "./source-routes";
import { computeNextObservationAt } from "./home-routes";
import { aggregateTags } from "./tag-routes";
import { loadVector, EMBEDDING_DIM } from "./observation-routes";

export const individualRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── event type strings (underscore per envelope type pattern) + dataschema refs ─
const MASTER_TYPE = "ihl.ind.master.v1";
const CROSS_TYPE = "ihl.ind.cross_parent.v1";
const NAME_TYPE = "ihl.ind.name_event.v1";
const BRAND_TYPE = "ihl.ind.brand_template.v1";
const LIFE_TYPE = "ihl.ind.life_event.v1";
const LINEAGE_DOUBT_TYPE = "ihl.ind.lineage_doubt.v1";
// cross-module read-only types (owned by observation / market / source packages).
const CAPTURE_TYPE = "ihl.obs.capture.v1";
const PHOTO_TYPE = "ihl.obs.photo.v1";
const SCHEDULE_TYPE = "ihl.obs.schedule.v1";
const DEVICE_TYPE = "ihl.obs.device.v1";
const OCCUPANCY_TYPE = "ihl.src.occupancy.v1";
const BINDING_TYPE = "ihl.src.device_binding.v1"; // FND-18 source module (V3-IND-13 環境時系列 join)
const TELEMETRY_TYPE = "ihl.src.telemetry.v1";
const TXN_TYPE = "ihl.mkt.transaction_event.v1";

const SCHEMA = {
  master: "schemas/events/ind-master.schema.json",
  cross: "schemas/events/ind-cross-parent.schema.json",
  name: "schemas/events/ind-name-event.schema.json",
  brand: "schemas/events/ind-brand-template.schema.json",
  life: "schemas/events/ind-life-event.schema.json",
  lineageDoubt: "schemas/events/ind-lineage-doubt.schema.json",
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

// ── V3-UIX-82 検索グラフビュー(近さ=形質/血縁のエンティティ紐づき図) ──────────
// 決定論の近さのみ(embedding cosine・血統)を使い、新規の重い基盤(グラフDB等)を
// 足さない。既存資産の再利用: buildPedigree(血縁)+ loadVector/cosineSimilarity
// (画像類似・observation-routes.ts と同一ロジック)。ホバー簡易ビュー/クリック
// 遷移はUI側(未着手・専用ノード追加が必要)の仕事で、本関数はデータ整形のみ。
export interface EntityGraphNode {
  individual_id: string;
  label: string;
  kind: "self" | "blood" | "similar";
  relation?: string; // blood ノードのみ: sire/dam/surrogate
}
export interface EntityGraphEdge {
  from: string;
  to: string;
  kind: "blood" | "similar";
  weight: number; // blood=1固定・similar=cosine類似度(0..1)
}
export interface EntityGraph {
  individual_id: string;
  nodes: EntityGraphNode[];
  edges: EntityGraphEdge[];
}

/** individual_id の最新capture(capture_id昇順末尾=既存 GET /individuals と同じ
 * 「最新」規約)のembeddingベクトルを返す(無ければnull)。 */
async function latestVectorFor(
  s: TruthStore,
  bucket: Bindings["TRUTH"],
  individualId: string,
): Promise<Float32Array | null> {
  const ref = `individual/${individualId}`;
  const caps = (await s.listEvents(`truth/${CAPTURE_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.subject_ref === ref)
    .sort((a, b) => String(a.capture_id ?? "").localeCompare(String(b.capture_id ?? "")));
  const latest = caps[caps.length - 1];
  if (!latest) return null;
  const vec = await loadVector(bucket, String(latest.capture_id));
  return vec && vec.length === EMBEDDING_DIM ? vec : null;
}

/** V3-UIX-82: 血縁(pedigree・maxDepth既定2)+ 画像類似(embedding cosine上位topK)
 * を1つのnodes/edgesグラフに統合する(都度再計算・常駐index無し・不変条項①)。 */
export async function projectEntityGraph(
  s: TruthStore,
  bucket: Bindings["TRUTH"],
  individualId: string,
  topK = 5,
  maxDepth = 2,
): Promise<EntityGraph> {
  const nodes: EntityGraphNode[] = [];
  const edges: EntityGraphEdge[] = [];
  const seen = new Set<string>([individualId]);
  const selfName = (await projectName(s, individualId)) ?? individualId;
  nodes.push({ individual_id: individualId, label: selfName, kind: "self" });

  // 血縁: pedigree を辿り known な祖先のみノード化(circular/truncated は葉のまま無視)。
  const pedigree = await buildPedigree(s, individualId, maxDepth);
  const walkBlood = async (node: PedigreeNode, childId: string): Promise<void> => {
    if (!node.known || node.circular) return;
    if (!seen.has(node.individual_id)) {
      seen.add(node.individual_id);
      const label = (await projectName(s, node.individual_id)) ?? node.individual_id;
      nodes.push({ individual_id: node.individual_id, label, kind: "blood", relation: node.parent_role });
    }
    edges.push({ from: childId, to: node.individual_id, kind: "blood", weight: 1 });
    for (const p of node.parents) await walkBlood(p, node.individual_id);
  };
  for (const p of pedigree.parents) await walkBlood(p, individualId);

  // 画像類似: 自分の最新capture embeddingと他個体の最新capture embeddingをcosine
  // 比較し上位topKのみ採用(O(n)全走査・design-c3 §1 と同じ縮退)。
  const myVec = await latestVectorFor(s, bucket, individualId);
  if (myVec) {
    const masters = (await s.listEvents(`truth/${MASTER_TYPE}/`))
      .map(dataOf)
      .map((m) => String(m.individual_id ?? ""))
      .filter((id) => id && id !== individualId);
    const scored: { individual_id: string; cos: number }[] = [];
    for (const id of masters) {
      const vec = await latestVectorFor(s, bucket, id);
      if (!vec) continue;
      scored.push({ individual_id: id, cos: cosineSimilarity(myVec, vec) });
    }
    scored.sort((a, b) => b.cos - a.cos || a.individual_id.localeCompare(b.individual_id));
    for (const { individual_id, cos } of scored.slice(0, topK)) {
      if (!seen.has(individual_id)) {
        seen.add(individual_id);
        const label = (await projectName(s, individual_id)) ?? individual_id;
        nodes.push({ individual_id, label, kind: "similar" });
      }
      edges.push({ from: individualId, to: individual_id, kind: "similar", weight: cos });
    }
  }

  return { individual_id: individualId, nodes, edges };
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
  // V3-IND-13 所有者履歴(owner_history): 所有者は Truth に常駐フィールドを
  // 持たない(不変条項① 派生値は都度再計算)。市場の transfer 取引イベント
  // (kind:"transfer"・individual_ids[] にこの個体が載った回だけ)を全件スキャンし
  // from(出品者actor)→to(相手)の系譜を組む — market-routes.ts の
  // projectOwnershipLineage(1 listing 単位)の個体横断版。mkt-listing 自体には
  // individual_ids リンクがまだ無い(MKT-29・別クラスタ残課題)ため、これは
  // 「取引が明示的に運んだ個体」だけを拾う(一般の出品検索連携は対象外のまま)。
  const owner_history = (await s.listEvents(`truth/${TXN_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.kind === "transfer" && Array.isArray(d.individual_ids) && (d.individual_ids as unknown[]).includes(id))
    .map((d) => ({
      listing_id: String(d.listing_id ?? ""),
      from: String(d.actor_id ?? ""),
      to: typeof d.counterparty === "string" ? d.counterparty : null,
      at: String(d.created_at ?? ""),
    }))
    .sort((a, b) => a.at.localeCompare(b.at));
  // V3-IND-13 環境履歴(environment_history): 現在地(projectIndividualProfile の
  // placement_id)だけでなく、この個体の occupancy 全件(start/end 相含む)を
  // 時系列で返す — 引っ越し全履歴。
  const environment_history = (await s.listEvents(`truth/${OCCUPANCY_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.subject_ref === ref)
    .map((d) => ({
      placement_id: String(d.placement_id ?? ""),
      phase: typeof d.phase === "string" ? d.phase : null,
      effective_at: String(d.effective_at ?? ""),
    }))
    .sort((a, b) => a.effective_at.localeCompare(b.effective_at) || a.placement_id.localeCompare(b.placement_id));
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
    owner_history,
    environment_history,
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
  // V3-IND-34 feature_tags: 既存の二層タグ集約(POST/GET /tags・target_type="individual")
  // を配線する — 新規タグ層は作らない。両層(ai/user)のどちらか一方でも0件だと
  // aggregateTags は null を返す(批評家#4 の 400 条件)ので、bio-card 側は
  // "タグ未登録" として静かに [] 扱いにする(エラーにしない)。
  const tagAgg = await aggregateTags(s, "individual", id);
  const feature_tags = tagAgg ? [...new Set([...tagAgg.ai_tags, ...tagAgg.user_tags])].sort() : [];
  return {
    individual_id: id,
    species: typeof m.species === "string" ? m.species : null,
    morph: null as string | null, // morph link is a later 波(taxon.morph is a master, not yet individual-linked)
    latest_size: latestSize,
    feature_tags,
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
    // V3-IND-21 疑義の記録(購入者が血統説明の矛盾を確認・記録できる文化):
    // POST/GET /individuals/{id}/lineage-doubt の LWW 投影(withdrawn で撤回)。
    doubts: await projectLineageDoubts(s, id),
  };
}

export interface LineageCheckIssue {
  code: string;
  detail?: string;
}
export interface LineageCheckResult {
  consistent: boolean;
  issues: LineageCheckIssue[];
}

/**
 * V3-IND-21 出品血統照合: cross-checks a CLAIMED sire_id/dam_id/species (the
 * only individual refs a market listing currently carries are the V3-IND-35
 * reservation_sire_id/reservation_dam_id fields — general listing↔individual
 * linkage for arbitrary sold individuals is MKT-29 territory, still todo/
 * blocked on that lane's own schema decision, NOT reimplemented here) against
 * actual Truth: do the referenced individuals exist, and does their recorded
 * species match the claim? Buyers get concrete issues to record their doubt
 * against, never a silently-trusted claim (誇張ゼロ). Read-only, pure fn of Truth.
 */
export async function checkLineageClaim(
  s: TruthStore,
  claim: { sire_id?: string; dam_id?: string; species?: string },
): Promise<LineageCheckResult> {
  const issues: LineageCheckIssue[] = [];
  const checkParent = async (id: string | undefined, role: "sire" | "dam") => {
    if (!id) return;
    const rec = await s.readEvent(`truth/${MASTER_TYPE}/${id}.json`);
    if (!rec) {
      issues.push({ code: `${role.toUpperCase()}_UNKNOWN`, detail: id });
      return;
    }
    const d = dataOf(rec);
    if (claim.species && typeof d.species === "string" && d.species && d.species !== claim.species) {
      issues.push({ code: `SPECIES_MISMATCH_${role.toUpperCase()}`, detail: `${d.species} != ${claim.species}` });
    }
  };
  await checkParent(claim.sire_id, "sire");
  await checkParent(claim.dam_id, "dam");
  if (claim.sire_id && claim.dam_id && claim.sire_id === claim.dam_id) {
    issues.push({ code: "SIRE_DAM_SAME_INDIVIDUAL" });
  }
  return { consistent: issues.length === 0, issues };
}

/** doubt_id 単位で最新の action(raised/withdrawn)を LWW 投影(active = raised のまま
 *  撤回されていないもの)。元レコードは消さない(不変条項③・撤回は新規追記)。 */
export async function projectLineageDoubts(
  s: TruthStore,
  id: string,
): Promise<{ doubt_id: string; listing_id: string | null; reason: string; actor_id: string; created_at: string }[]> {
  const rows = (await s.listEvents(`truth/${LINEAGE_DOUBT_TYPE}/${id}-`))
    .map(dataOf)
    .filter((d) => d.individual_id === id);
  const latestByDoubt = new Map<string, Record<string, unknown>>();
  for (const r of rows.slice().sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))) {
    const key = String(r.doubt_id ?? "");
    if (key) latestByDoubt.set(key, r);
  }
  return [...latestByDoubt.values()]
    .filter((r) => r.action === "raised")
    .map((r) => ({
      doubt_id: String(r.doubt_id ?? ""),
      listing_id: typeof r.listing_id === "string" ? r.listing_id : null,
      reason: String(r.reason ?? ""),
      actor_id: String(r.actor_id ?? ""),
      created_at: String(r.created_at ?? ""),
    }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** 直近 molt の detail.to_stage(life は at 昇順ソート済み前提)。V3-IND-20 の
 *  スケジュール自動生成(現在の成長ステージ自動検出)と projectIndividualProfile
 *  の両方が使う共通の導出(コピペ二重化しない)。 */
export function deriveCurrentStage(life: Record<string, unknown>[]): string | null {
  const molts = life.filter((d) => d.kind === "molt");
  const latestMolt = molts[molts.length - 1];
  return latestMolt && typeof latestMolt.detail === "object" && latestMolt.detail !== null
    ? ((latestMolt.detail as Record<string, unknown>).to_stage as string | undefined) ?? null
    : null;
}

/**
 * individual-detail スライスA投影 (V3-AIP-101 c7-wireframes-core5 §4 F1/F2)。
 * 判断3指標(成長比較・血統健全度・近交リスク)とタイムラインが1レスポンスで
 * 描画できる形に集約する。無いものは null/[](親カーブ欠損は第一級状態
 * [訂正8] — エラーではなく空配列/null で正常表現)。近交F係数はクライアント
 * が /pedigree から計算する(このAPIは生データのみ返す)。
 * ponytail: O(n) 複数回 listEvents 全件スキャン(既存 GET /individuals 一覧と
 * 同じ縮退)。captures/life-events は1回ずつ全件取得しメモリ上でフィルタして
 * 使い回す(親・きょうだいぶんの再スキャンをしない)。常駐キャッシュは持たない
 * (都度再計算・不変条項①)。
 */
export interface EnvironmentReading {
  device_id: string;
  metric: string;
  bucket_start_ms: number;
  mean: number;
  count: number;
}

/**
 * Environment time series for a placement (V3-IND-13 「環境(時系列)」統合):
 * placement_id → open device_binding(s) at that placement → their
 * ihl.src.telemetry.v1 bucketized readings (V3-FND-18). Read-only join, no
 * writes — this is a lightweight display embed, not the telemetry pipeline's
 * own source-of-truth reconciliation (that stays projectTelemetryLatest in
 * source-routes.ts, which additionally arbitrates multi-source duplicate
 * buckets by count/source priority). Scoped to the individual's CURRENT
 * placement only (not full move history — a later 波 if move-by-move
 * environment history is required). Deterministic, O(bindings + telemetry).
 */
async function projectEnvironment(s: TruthStore, placementId: string | null): Promise<EnvironmentReading[]> {
  if (!placementId) return [];
  // 「open device_binding(s)」= このplacementでSTARTしたが、後からENDされていない
  // もの(projectOpenBindings 再利用・source-routes.ts の 409 判定と同じ open/closed
  // 意味論)。startイベント単独だとappend-onlyゆえ「昔ここにいた」痕跡が永遠に残る
  // ため、デバイスが別placementへunbind→rebindされた後もそのまま拾ってしまい、
  // 再配置先の最新テレメトリをこのindividualの環境として誤帰属してしまう
  // (批評家指摘)。ここではopenのものだけをdeviceに採用する。
  const candidates = (await s.listEvents(`truth/${BINDING_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.placement_id === placementId && d.phase === "start");
  const deviceIds = new Set<string>();
  for (const d of candidates) {
    const deviceId = String(d.device_id);
    const open = await projectOpenBindings(s, deviceId);
    if (open.includes(String(d.binding_id))) deviceIds.add(deviceId);
  }
  if (!deviceIds.size) return [];
  // ponytail: 現在openなbindingのdeviceを対象に「全期間」のテレメトリを返す
  // (bindingのeffective_atによる下限クランプはしない) — 同じdeviceが一度よそへ
  // 出て「同じplacementへ」戻ってきた場合、その中抜け期間の読み取りが混ざる
  // ケースは残るが、今回の指摘(=別placementへ出たまま戻らないケース)はopen
  // 判定だけで解消する。必要になったらbindingごとのeffective_at以降のみに絞る。
  const readings: EnvironmentReading[] = [];
  for (const e of await s.listEvents(`truth/${TELEMETRY_TYPE}/`)) {
    const d = dataOf(e);
    const deviceId = String(d.device_id ?? "");
    if (!deviceIds.has(deviceId) || typeof d.metric !== "string" || typeof d.bucket_start_ms !== "number") continue;
    readings.push({
      device_id: deviceId,
      metric: d.metric,
      bucket_start_ms: d.bucket_start_ms,
      mean: Number(d.mean),
      count: Number(d.count),
    });
  }
  return readings.sort((a, b) => a.bucket_start_ms - b.bucket_start_ms || a.metric.localeCompare(b.metric));
}

export async function projectIndividualProfile(s: TruthStore, id: string) {
  const master = await s.readEvent(`truth/${MASTER_TYPE}/${id}.json`);
  const ref = `individual/${id}`;
  const m = master ? dataOf(master) : null;

  const allLife = (await s.listEvents(`truth/${LIFE_TYPE}/`)).map(dataOf);
  const lifeOf = (pid: string) => allLife.filter((d) => d.individual_id === pid);
  const life = lifeOf(id).sort((a, b) => String(a.at).localeCompare(String(b.at)));

  // グラフの X 軸(初回観測からの日数)は capture data 自身に時刻を持たない
  // (envelope.time が唯一の時刻ソース・既存 GET /individuals の last_capture_at
  // と同じ規約)ので、data に time を合成して1個の行として持ち回す。
  const allCaptures = (await s.listEvents(`truth/${CAPTURE_TYPE}/`)).map((e) => ({
    ...dataOf(e),
    time: String(e.time ?? ""),
  }));
  const capturesOf = (pid: string) =>
    allCaptures
      .filter((d) => d.subject_ref === `individual/${pid}`)
      .sort((a, b) => String(a.capture_id ?? "").localeCompare(String(b.capture_id ?? "")));
  const observations = capturesOf(id);

  // 写真参照(V3-AIP-101 fix2・ヘッダ代表サムネ+タイムライン小サムネ): capture
  // ごとに先頭 photo_id を解決して添える(projectAuthenticity の image_chain と
  // 同じ per-capture listEvents(prefix) 方式・O(n) 前例あり)。
  for (const obs of observations) {
    const capId = String(obs.capture_id ?? "");
    const photos = capId ? (await s.listEvents(`truth/${PHOTO_TYPE}/${capId}-`)).map(dataOf) : [];
    const photoId = photos.length ? String(photos[0].photo_id ?? "") : null;
    obs.photo_id = photoId || null;
    obs.thumbnail_path = photoId ? `/api/v1/observation/${capId}/thumbnail/${photoId}` : null;
  }
  // ヘッダ代表写真: 最新観測から遡って最初に写真がある capture のサムネ
  // (GET /individuals 一覧の thumbnail_path と同じ規約)。
  let thumbnail_path: string | null = null;
  for (let i = observations.length - 1; i >= 0; i--) {
    if (observations[i].thumbnail_path) {
      thumbnail_path = observations[i].thumbnail_path as string;
      break;
    }
  }

  if (!master && observations.length === 0 && life.length === 0) return null;

  // stage: 直近 molt の detail.to_stage。
  const stage = deriveCurrentStage(life);

  // status: death/survival_correction のうち時刻が最も新しいものが勝つ
  // (誤記録の訂正は append-only の新レコード追記 — 元の death は消さない・不変条項③)。
  const statusOf = (evs: Record<string, unknown>[]): "alive" | "deceased" => {
    const rows = evs
      .filter((d) => d.kind === "death" || d.kind === "survival_correction")
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));
    return rows.length && rows[rows.length - 1].kind === "death" ? "deceased" : "alive";
  };
  const status = statusOf(life);

  const placement = (await s.listEvents(`truth/${OCCUPANCY_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.subject_ref === ref && d.phase !== "end")
    .sort((a, b) => String(a.effective_at).localeCompare(String(b.effective_at)));
  const placement_id = placement.length ? (placement[placement.length - 1].placement_id as string) : null;

  const labelOf = async (pid: string): Promise<string> => {
    const pm = await s.readEvent(`truth/${MASTER_TYPE}/${pid}.json`);
    const pd = pm ? dataOf(pm) : null;
    const nm = await projectName(s, pid);
    return (pd?.local_label_text as string | undefined) || nm || pid;
  };

  const allCross = (await s.listEvents(`truth/${CROSS_TYPE}/`)).map(dataOf);
  const parentLinks = allCross.filter((d) => d.child_id === id);
  const sireLink = parentLinks.find((d) => d.parent_role === "sire");
  const damLink = parentLinks.find((d) => d.parent_role === "dam");
  const parents: Record<string, { individual_id: string; label: string }> = {};
  if (sireLink) parents.sire = { individual_id: String(sireLink.parent_id), label: await labelOf(String(sireLink.parent_id)) };
  if (damLink) parents.dam = { individual_id: String(damLink.parent_id), label: await labelOf(String(damLink.parent_id)) };

  const childIds = [...new Set(allCross.filter((d) => d.parent_id === id).map((d) => String(d.child_id)))].sort();
  const children: { individual_id: string; label: string }[] = [];
  for (const cid of childIds) children.push({ individual_id: cid, label: await labelOf(cid) });

  // きょうだい = sire・dam の両方が一致する他個体のみ(半きょうだいは対象外)。
  // 片親でも系統不明なら siblings=[](「同じ sire&dam を持つ」が判定不能)。
  const siblings: { individual_id: string; label: string; dead: boolean; eclosed: boolean }[] = [];
  if (sireLink && damLink) {
    const bySire = allCross.filter((d) => d.parent_role === "sire" && d.parent_id === sireLink.parent_id).map((d) => String(d.child_id));
    const byDam = new Set(
      allCross.filter((d) => d.parent_role === "dam" && d.parent_id === damLink.parent_id).map((d) => String(d.child_id)),
    );
    const sibIds = [...new Set(bySire.filter((cid) => byDam.has(cid) && cid !== id))];
    for (const sid of sibIds) {
      const sLife = lifeOf(sid);
      siblings.push({
        individual_id: sid,
        label: await labelOf(sid),
        dead: statusOf(sLife) === "deceased",
        eclosed: sLife.some((d) => d.kind === "eclosion"),
      });
    }
  }

  const parent_observations = {
    sire: sireLink ? capturesOf(String(sireLink.parent_id)) : [],
    dam: damLink ? capturesOf(String(damLink.parent_id)) : [],
  };

  // 兄弟の観測は体重/体長のみの軽い形(コホート帯の min-max 計算専用)。
  const cohort_observations: { individual_id: string; capture_id: string; weight_g: number | null; length_mm: number | null }[] = [];
  for (const sib of siblings) {
    for (const cap of capturesOf(sib.individual_id)) {
      cohort_observations.push({
        individual_id: sib.individual_id,
        capture_id: String(cap.capture_id ?? ""),
        weight_g: latestMeasure(cap, "weight"),
        length_mm: latestMeasure(cap, "length"),
      });
    }
  }

  // 次の目安(中立表示専用・「予定」ではない — ユーザー裁定2026-07-12第1陣②)。
  // 直近登録された ihl.obs.schedule.v1 の next_observation_at のみ返す。起点の
  // from/間隔日数は ihl.obs.schedule.v1 に保存されない(POST /observation/schedule
  // は都度計算した next_observation_at だけを INSERT する設計・home-routes.ts)
  // ので、created_at からの逆算は書き込み時刻とズレて不正確 — 出さない
  // (誇張ゼロ: 不正確な数字よりゼロ情報のほうが誠実)。
  const schedules = (await s.listEvents(`truth/${SCHEDULE_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.individual_id === id)
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  const latestSchedule = schedules[schedules.length - 1];
  const schedule = latestSchedule ? { next_observation_at: String(latestSchedule.next_observation_at ?? "") } : null;

  return {
    individual_id: id,
    master: m,
    name: await projectName(s, id),
    species: (m?.species as string | undefined) ?? null,
    stage,
    status,
    thumbnail_path,
    placement_id,
    environment: await projectEnvironment(s, placement_id), // V3-IND-13 環境(時系列)統合
    schedule,
    parents,
    siblings,
    children,
    observations,
    life_events: life,
    parent_observations,
    cohort_observations,
  };
}

// ── routes ────────────────────────────────────────────────────────────────────

// Shared master-creation logic (IND-02). Extracted so clutch promote (C7
// スライス2) generates individuals the SAME way as POST /individuals instead
// of re-implementing envelope/key construction (コピペ二重化しない).
export async function createIndividualMaster(
  s: TruthStore,
  actorId: string,
  fields: {
    individual_id?: string;
    local_label_text?: string;
    species?: string;
    birth_or_hatch_date?: string;
    source_type?: string;
    lineage_id?: string; // V3-IND-34 複数系統並行管理タグ
  },
): Promise<{ individualId: string; res: Awaited<ReturnType<TruthStore["putEventAt"]>> }> {
  const individualId =
    typeof fields.individual_id === "string" && fields.individual_id ? fields.individual_id : ulid();
  const data: Record<string, unknown> = {
    individual_id: individualId,
    actor_id: actorId,
    created_at: nowIso(),
  };
  for (const k of ["local_label_text", "species", "birth_or_hatch_date", "source_type", "lineage_id"] as const) {
    if (fields[k] !== undefined) data[k] = fields[k];
  }
  const res = await s.putEventAt(
    `truth/${MASTER_TYPE}/${individualId}.json`,
    envelope(MASTER_TYPE, SCHEMA.master, actorId, data),
  );
  // V3-KRM-28: 個体作成成功時の研究貢献度フック(axis=research・source=observation・
  // +10)。ベストエフォート(失敗しても個体作成自体は成立済み・呼び出し元を壊さない)。
  if (res.status === "inserted") {
    try {
      await appendContribution(s, actorId, individualId, "research", CONTRIB_INDIVIDUAL_CREATED, "observation");
    } catch (e) {
      console.error("KRM-28 individual_created contribution hook failed:", e);
    }
  }
  return { individualId, res };
}

// Shared blood-link logic (IND-01/12), reused by clutch promote to inherit
// sire_id/dam_id (コピペ二重化しない). Same key/conflict semantics as the route.
// Ownership guard (fail-closed, T-71 GAP①): only the CHILD's current owner
// (source-routes.ts projectCurrentOwner — transfer-aware, same trust boundary
// as POST /occupancy) may append a blood link for it. clutch promote's calls
// pass a freshly-minted individualId it just created (owner===actorId there
// by construction), so this is a no-op guard on that path and the real gate
// on the direct route below.
export async function linkParent(
  bucket: R2BucketLite,
  s: TruthStore,
  actorId: string,
  childId: string,
  parentId: string,
  role: string,
): Promise<Awaited<ReturnType<TruthStore["putEventAt"]>> | { status: "forbidden" }> {
  const owner = await projectCurrentOwner(bucket, childId);
  if (owner !== actorId) return { status: "forbidden" };
  const data: Record<string, unknown> = {
    child_id: childId,
    parent_id: parentId,
    parent_role: role,
    actor_id: actorId,
    created_at: nowIso(),
  };
  return s.putEventAt(
    `truth/${CROSS_TYPE}/${childId}-${role}.json`,
    envelope(CROSS_TYPE, SCHEMA.cross, actorId, data),
  );
}

// POST /individuals — create a master record (no growth fields · IND-02).
// individual_id: client MAY supply (idempotency → 409); else generated.
individualRoutes.post("/individuals", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");
  const { individualId, res } = await createIndividualMaster(store(c), actorId, {
    individual_id: typeof body.individual_id === "string" ? body.individual_id : undefined,
    local_label_text: body.local_label_text as string | undefined,
    species: body.species as string | undefined,
    birth_or_hatch_date: body.birth_or_hatch_date as string | undefined,
    source_type: body.source_type as string | undefined,
    lineage_id: typeof body.lineage_id === "string" ? body.lineage_id : undefined,
  });
  if (res.status === "invalid") return c.json({ error: "INVALID_INDIVIDUAL", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_INDIVIDUAL", key: res.key }, 409);
  return c.json({ individual_id: individualId }, 201);
});

// 磨き直し fix#2: pick the representative measurement string for a capture's
// row — weight if the capture recorded one (the common "82.5g" summary), else
// whatever measurement item comes first. null when the capture carried none.
function representativeMeasurement(data: Record<string, unknown>): string | null {
  const ms = Array.isArray(data.measurements) ? (data.measurements as Record<string, unknown>[]) : [];
  const pick = ms.find((m) => m.item === "weight" && typeof m.value === "number") ?? ms.find((m) => typeof m.value === "number");
  return pick ? `${pick.value}${pick.unit ?? ""}` : null;
}

// Shared label/species/last_capture_at/last_measurement_summary derivation —
// the exact fallback formulas GET /individuals rows use. Extracted (unchanged
// behavior) so the multi-occupant shelf-QR branch (OBS wave1 R2・
// projectIndividualSummary below) reuses ONE projection instead of a
// re-derived variant (source-routes projectOccupantsAt callers).
function summarizeIndividualRow(
  id: string,
  master: Record<string, unknown> | null,
  name: string | null,
  caps: { data: Record<string, unknown>; time: string }[],
): { label: string; species: string | null; last_capture_at: string | null; last_measurement_summary: string | null } {
  const rawLabel = typeof master?.local_label_text === "string" ? master.local_label_text : "";
  const rawSpecies = typeof master?.species === "string" ? master.species : "";
  const sorted = caps.slice().sort((a, b) => String(a.data.capture_id ?? "").localeCompare(String(b.data.capture_id ?? "")));
  const latest = sorted[sorted.length - 1];
  return {
    label: rawLabel || name || id,
    species: rawSpecies || null,
    last_capture_at: latest ? latest.time || null : null,
    last_measurement_summary: latest ? representativeMeasurement(latest.data) : null,
  };
}

/** Per-id fetch + summarizeIndividualRow — for a single individual outside the
 * bulk GET /individuals scan (small occupant counts on a multi-occupant shelf,
 * OBS wave1 R2 V3-OBS-2x qr_placement_multi). Same fields, same fallback rules. */
export async function projectIndividualSummary(
  s: TruthStore,
  id: string,
): Promise<{ individual_id: string; label: string; species: string | null; last_capture_at: string | null; last_measurement_summary: string | null }> {
  const masterEv = await s.readEvent(`truth/${MASTER_TYPE}/${id}.json`);
  const master = masterEv ? dataOf(masterEv) : null;
  const name = await projectName(s, id);
  const ref = `individual/${id}`;
  const caps = (await s.listEvents(`truth/${CAPTURE_TYPE}/`))
    .filter((e) => dataOf(e).subject_ref === ref)
    .map((e) => ({ data: dataOf(e), time: String(e.time ?? "") }));
  return { individual_id: id, ...summarizeIndividualRow(id, master, name, caps) };
}

// V3-IND-14 一覧フィルタ軸「状態(生体/蛹/幼虫/死亡/標本)」の5値判定。優先度:
// 直近の終端 life-event(death/survival_correction/specimen・at 昇順末尾)が
// specimen なら standing の死活を問わず標本、death なら死亡。survival_correction
// が最新なら死亡訂正済み=生存側へ戻り、蛹(直近 molt.detail.to_stage==="pupa")
// →生体(eclosion 済み=成虫)→幼虫(既定)の順で判定する。
function deriveLifeStatus(
  terminals: Record<string, unknown>[],
  stage: string | null,
  hasEclosion: boolean,
): "alive" | "pupa" | "larva" | "dead" | "specimen" {
  const last = terminals.slice().sort((a, b) => String(a.at).localeCompare(String(b.at))).pop();
  if (last?.kind === "specimen") return "specimen";
  if (last?.kind === "death") return "dead";
  if (stage === "pupa") return "pupa";
  if (hasEclosion) return "alive";
  return "larva";
}

// V3-IND-14 ソート軸ホワイトリスト(最新観測/観測数/体長/体重/次の予定)。未知の
// sort 値は既定(individual_id 昇順)へフォールバックする(決定論を崩さない)。
const LIST_SORT_FIELDS = new Set([
  "last_capture_at",
  "capture_count",
  "latest_length_mm",
  "latest_weight_g",
  "next_observation_at",
]);

// GET /individuals?q= — 本人の個体一覧/検索(V3-AIP-101 観測登録スライス1 F1).
// q が local_label_text/name/species の部分一致(大小無視)に当たる個体のみ返す。
// q なしは本人の全件。label は local_label_text→name→id の優先で埋める。
// last_capture_at/last_measurement_summary(磨き直し fix#2): 検索結果テーブルの
// 「最終観測」列。capture_id(ULID)昇順=時刻順の規約に乗せ、envelope の `time`
// を返す(data には capture 自身のタイムスタンプが無い・latestMeasurement と
// 同じ規約)。
// スライス2拡張(C7): stage(直近 molt life-event の detail.to_stage)/
// placement_id(直近 occupancy start・phase="end"は除外)/last_care_at(直近
// capture の at=last_capture_at と同値。F4 一覧が「お世話」語彙で読む列)。
// 検索スライスA拡張(C7): latest_weight_g/latest_length_mm/capture_count(直近
// capture・既存 latest 変数を再利用)/eclosion_at(life-event 走査に eclosion
// 分岐を追加・molt と同じループに畳み込み=スキャン追加なし)/thumbnail_path
// (PHOTO_TYPE の 4 本目の全件スキャンを追加・capture_id→先頭 photo_id の
// マップを作り、個体の caps を新しい方から辿って最初にヒットした capture の
// サムネ URL を返す)。
// A1 一覧フィルタ拡張(V3-IND-14・obs-search の決定論梯子=画像類似検索とは別軸の
// 構造化フィルタ): ?species=/?stage=/?status= は完全一致(大小無視は species の
// み・stage/status はコード値の exact match)、?sort=/?order= は
// LIST_SORT_FIELDS のみ許可し既定は individual_id 昇順のまま。棚移動・瓶交換等の
// 一括操作/形態(morph)・テンプレート・棚・スケジュール状態フィルタは対象外
// (V3-IND-14 残課題・morph は個体未連携=projectBioCard 既存注記と同じ理由)。
// ponytail: O(n) full master + capture/life-event/occupancy/photo/schedule
// scan(1回ずつ、計5本), per-actor/individual index は在庫が伸びたら昇格(既存
// /observation/search 前例と同じ縮退)。
// V3-IND-12 率カードドリルダウン: ?parent_id=+?status= の組合せで血統(Cross)画面
// の率カード(死亡率/羽化不全率等)から「この親のコホートで死亡した子」のような
// 詳細一覧へ遷移できる(cohort=offspringOf(parent_id)・既存 status フィルタと
// AND)。lineage_id は別軸(V3-IND-34・複数系統タグ)— こちらは血統(親子関係)の
// コホート、lineage_id は横断タグで意味が違うため別 query param のまま併存する。
// V3-UIX-68(透明性の文化): 一覧構築ロジックを actorId 引数化し、本人用(session
// scope)と公開プロフィール用(GET /users/{actor}/individuals・他者のマイページに
// その人の作品を全表示)の2 route から共用する(重複実装を避ける・ロジックは1本)。
async function listIndividualsFor(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  actorId: string,
) {
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const speciesFilter = (c.req.query("species") ?? "").trim().toLowerCase();
  const stageFilter = c.req.query("stage") ?? "";
  const statusFilter = c.req.query("status") ?? "";
  const parentIdFilter = c.req.query("parent_id") ?? ""; // V3-IND-12 率カード→詳細一覧ドリルダウン(?parent_id=+?status=でコホート絞り込み)
  const lineageFilter = c.req.query("lineage_id") ?? ""; // V3-IND-34 複数系統並行管理(完全一致)
  const sortKey = c.req.query("sort") ?? "";
  const sortOrder = c.req.query("order") === "asc" ? 1 : -1; // 既定 desc(新しい/多い/大きい順)
  const s = store(c);
  const cohortIds = parentIdFilter ? new Set(await offspringOf(s, parentIdFilter)) : null;
  const masters = (await s.listEvents(`truth/${MASTER_TYPE}/`))
    .map(dataOf)
    .filter((m) => m.actor_id === actorId)
    .filter((m) => !cohortIds || cohortIds.has(String(m.individual_id ?? "")));
  const capturesByIndividual = new Map<string, { data: Record<string, unknown>; time: string }[]>();
  for (const e of await s.listEvents(`truth/${CAPTURE_TYPE}/`)) {
    const d = dataOf(e);
    const ref = typeof d.subject_ref === "string" ? d.subject_ref : "";
    if (!ref.startsWith("individual/")) continue;
    const id = ref.slice("individual/".length);
    const rows = capturesByIndividual.get(id) ?? [];
    rows.push({ data: d, time: String(e.time ?? "") });
    capturesByIndividual.set(id, rows);
  }
  const moltsByIndividual = new Map<string, Record<string, unknown>[]>();
  const eclosionsByIndividual = new Map<string, Record<string, unknown>[]>();
  // V3-IND-14 状態フィルタ用: death/survival_correction/specimen(deriveLifeStatus
  // の入力)。既存の molt/eclosion ループへ1分岐追加するだけで新規スキャンなし。
  const terminalsByIndividual = new Map<string, Record<string, unknown>[]>();
  for (const e of await s.listEvents(`truth/${LIFE_TYPE}/`)) {
    const d = dataOf(e);
    const id = String(d.individual_id ?? "");
    if (!id) continue;
    if (d.kind === "molt") (moltsByIndividual.get(id) ?? moltsByIndividual.set(id, []).get(id)!).push(d);
    else if (d.kind === "eclosion")
      (eclosionsByIndividual.get(id) ?? eclosionsByIndividual.set(id, []).get(id)!).push(d);
    else if (d.kind === "death" || d.kind === "survival_correction" || d.kind === "specimen")
      (terminalsByIndividual.get(id) ?? terminalsByIndividual.set(id, []).get(id)!).push(d);
  }
  // 検索スライスA: capture_id → 先頭 photo_id(1個体1capture分あれば十分・
  // サムネは最新観測の代表1枚)。既存3本の全件スキャンと同じ O(n) スタイル。
  const firstPhotoByCapture = new Map<string, string>();
  for (const e of await s.listEvents(`truth/${PHOTO_TYPE}/`)) {
    const d = dataOf(e);
    const capId = String(d.capture_id ?? "");
    const photoId = String(d.photo_id ?? "");
    if (!capId || !photoId || firstPhotoByCapture.has(capId)) continue;
    firstPhotoByCapture.set(capId, photoId);
  }
  // V3-IND-14 ソート軸「次の予定」: schedule 単位で最新(created_at 最大)の
  // next_observation_at を採用(individual-detail profile と同じ規約)。
  const scheduleByIndividual = new Map<string, Record<string, unknown>[]>();
  for (const e of await s.listEvents(`truth/${SCHEDULE_TYPE}/`)) {
    const d = dataOf(e);
    const id = String(d.individual_id ?? "");
    if (!id) continue;
    (scheduleByIndividual.get(id) ?? scheduleByIndividual.set(id, []).get(id)!).push(d);
  }
  const placementByIndividual = new Map<string, Record<string, unknown>[]>();
  for (const e of await s.listEvents(`truth/${OCCUPANCY_TYPE}/`)) {
    const d = dataOf(e);
    if (d.phase === "end") continue; // 現在地の候補から除外(引っ越し済み)
    const ref = typeof d.subject_ref === "string" ? d.subject_ref : "";
    if (!ref.startsWith("individual/")) continue;
    const id = ref.slice("individual/".length);
    (placementByIndividual.get(id) ?? placementByIndividual.set(id, []).get(id)!).push(d);
  }
  const individuals: Record<string, unknown>[] = [];
  for (const m of masters) {
    const id = String(m.individual_id ?? "");
    if (!id) continue;
    const label = typeof m.local_label_text === "string" ? m.local_label_text : "";
    const species = typeof m.species === "string" ? m.species : "";
    const name = await projectName(s, id);
    if (q && ![label, species, name ?? ""].some((v) => v.toLowerCase().includes(q))) continue;
    const caps = (capturesByIndividual.get(id) ?? [])
      .slice()
      .sort((a, b) => String(a.data.capture_id ?? "").localeCompare(String(b.data.capture_id ?? "")));
    const latest = caps[caps.length - 1];
    const molts = (moltsByIndividual.get(id) ?? []).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const latestMolt = molts[molts.length - 1];
    const stage =
      latestMolt && typeof latestMolt.detail === "object" && latestMolt.detail !== null
        ? ((latestMolt.detail as Record<string, unknown>).to_stage as string | undefined) ?? null
        : null;
    const placements = (placementByIndividual.get(id) ?? [])
      .slice()
      .sort((a, b) => String(a.effective_at).localeCompare(String(b.effective_at)));
    const latestPlacement = placements[placements.length - 1];
    const eclosions = (eclosionsByIndividual.get(id) ?? [])
      .slice()
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const latestEclosion = eclosions[eclosions.length - 1];
    const lifeStatus = deriveLifeStatus(terminalsByIndividual.get(id) ?? [], stage, eclosions.length > 0);
    const schedules = (scheduleByIndividual.get(id) ?? [])
      .slice()
      .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
    const latestSchedule = schedules[schedules.length - 1];
    const nextObservationAt = latestSchedule ? String(latestSchedule.next_observation_at ?? "") || null : null;
    // V3-IND-14 多軸フィルタ: species/stage/status は完全一致(species は大小
    // 無視・q の部分一致キーワード検索とは別軸)。
    if (speciesFilter && species.toLowerCase() !== speciesFilter) continue;
    if (stageFilter && stage !== stageFilter) continue;
    if (statusFilter && lifeStatus !== statusFilter) continue;
    const lineageId = typeof m.lineage_id === "string" ? m.lineage_id : null;
    if (lineageFilter && lineageId !== lineageFilter) continue; // V3-IND-34 完全一致
    // 最新観測から遡って最初に写真がある capture のサムネ URL(無ければ null)。
    let thumbnailPath: string | null = null;
    for (let i = caps.length - 1; i >= 0; i--) {
      const capId = String(caps[i].data.capture_id ?? "");
      const photoId = capId ? firstPhotoByCapture.get(capId) : undefined;
      if (photoId) {
        thumbnailPath = `/api/v1/observation/${capId}/thumbnail/${photoId}`;
        break;
      }
    }
    const row = summarizeIndividualRow(id, m, name, caps);
    individuals.push({
      individual_id: id,
      label: row.label,
      name,
      species: row.species,
      last_capture_at: row.last_capture_at,
      last_measurement_summary: row.last_measurement_summary,
      stage,
      placement_id: latestPlacement ? (latestPlacement.placement_id as string) : null,
      last_care_at: latest ? latest.time || null : null,
      latest_weight_g: latest ? latestMeasure(latest.data, "weight") : null,
      latest_length_mm: latest ? latestMeasure(latest.data, "length") : null,
      capture_count: caps.length,
      eclosion_at: latestEclosion ? String(latestEclosion.at ?? "") || null : null,
      thumbnail_path: thumbnailPath,
      life_status: lifeStatus,
      next_observation_at: nextObservationAt,
      lineage_id: lineageId, // V3-IND-34 複数系統並行管理タグ
    });
  }
  if (LIST_SORT_FIELDS.has(sortKey)) {
    individuals.sort((a, b) => {
      const av = a[sortKey] as number | string | null;
      const bv = b[sortKey] as number | string | null;
      if (av === null || bv === null) {
        if (av === bv) return String(a.individual_id).localeCompare(String(b.individual_id));
        return av === null ? 1 : -1; // null は方向によらず末尾
      }
      if (av === bv) return String(a.individual_id).localeCompare(String(b.individual_id));
      return av < bv ? -sortOrder : sortOrder;
    });
  } else {
    individuals.sort((a, b) => String(a.individual_id).localeCompare(String(b.individual_id)));
  }
  return c.json({ individuals });
}

individualRoutes.get("/individuals", async (c) => listIndividualsFor(c, c.get("actorId")));

// GET /users/{actor}/individuals — 公開版(V3-UIX-68・透明性の文化: 相手のマイページ
// でその人の作品=個体一覧を全て見れるようにする)。ロジックは本人用と同一
// (listIndividualsFor)・スコープだけ actor path param に変える。
individualRoutes.get("/users/:actor/individuals", async (c) => listIndividualsFor(c, c.req.param("actor")));

// GET /individuals/lineage-check?sire_id=&dam_id=&species= — 出品血統照合
// (V3-IND-21)。少なくとも sire_id/dam_id のどちらかが必須(単体チェック用途)。
// NOTE: must be registered BEFORE GET /individuals/:id below — Hono's router
// resolves this same-depth static-vs-param overlap by REGISTRATION ORDER (first
// match wins), not by static-precedence, so this has to come first or `:id`
// would swallow "lineage-check" as a literal id (verified by TC).
individualRoutes.get("/individuals/lineage-check", async (c) => {
  const sireId = c.req.query("sire_id") || undefined;
  const damId = c.req.query("dam_id") || undefined;
  const species = c.req.query("species") || undefined;
  if (!sireId && !damId) {
    return c.json({ error: "INVALID_LINEAGE_CHECK", details: ["sire_id or dam_id required"] }, 400);
  }
  return c.json(await checkLineageClaim(store(c), { sire_id: sireId, dam_id: damId, species }));
});

// GET /individuals/pedigree-links — T-66(design-individual-finder.md §3/§5波3・
// V3-UIX-83後続波)全個体宇宙面の血統エッジ投影。GET /individuals(一覧)には血統
// エッジ自体が載っていない(lineage_idは系統タグで別物・血統はper-individualの
// /pedigree でしか取れない)ため、宇宙面が全個体を一括で血統分類(先祖/子孫発光・
// 世代軸算出)するにはこの一覧が要る。listIndividualsFor と同じ「本人所有の個体」
// スコープに絞る(他者の血統情報は返さない)。cross_parent Truth を都度全件scan
// (常駐indexなし・不変条項①)。NOTE: `/individuals/:id` より前に登録
// (lineage-check と同じ static-vs-param 順序の理由)。
// HDR-1(c9-structure-canon.md §1c/R112/R115)ヘッダー観測対象セレクタ配線:
// ?species=/?lineage_id= は listIndividualsFor と同じフィルタ規約(species は
// 大小無視の完全一致・lineage_id は完全一致)を ownIds の絞り込みに横展開する
// (エッジ自身に種/系統フィールドは無いので、両端が対象母集団に入っている
// リンクだけを返す=個体一覧側フィルタと同じ母集団に揃える)。
individualRoutes.get("/individuals/pedigree-links", async (c) => {
  const actorId = c.get("actorId");
  const speciesFilter = (c.req.query("species") ?? "").trim().toLowerCase();
  const lineageFilter = c.req.query("lineage_id") ?? "";
  const s = store(c);
  const ownIds = new Set(
    (await s.listEvents(`truth/${MASTER_TYPE}/`))
      .map(dataOf)
      .filter((m) => m.actor_id === actorId)
      .filter((m) => !speciesFilter || (typeof m.species === "string" && m.species.toLowerCase() === speciesFilter))
      .filter((m) => !lineageFilter || m.lineage_id === lineageFilter)
      .map((m) => String(m.individual_id ?? "")),
  );
  const links = (await s.listEvents(`truth/${CROSS_TYPE}/`))
    .map(dataOf)
    .filter((d) => ownIds.has(String(d.child_id ?? "")) && ownIds.has(String(d.parent_id ?? "")))
    .map((d) => ({
      child_id: String(d.child_id),
      parent_id: String(d.parent_id),
      parent_role: String(d.parent_role ?? ""),
    }))
    .sort((a, b) => a.child_id.localeCompare(b.child_id) || a.parent_id.localeCompare(b.parent_id));
  return c.json({ links });
});

// GET /individuals/{id} — whole-individual projection (6 文化 + timeline · IND-13).
individualRoutes.get("/individuals/:id", async (c) => {
  const proj = await projectIndividual(store(c), c.req.param("id"));
  if (!proj) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json(proj);
});

// GET /individuals/{id}/profile — individual-detail スライスA投影 (V3-AIP-101).
individualRoutes.get("/individuals/:id/profile", async (c) => {
  const proj = await projectIndividualProfile(store(c), c.req.param("id"));
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
  const res = await linkParent(c.env.TRUTH, store(c), actorId, childId, String(body.parent_id), String(role));
  if (res.status === "forbidden") return c.json({ error: "NOT_OWNER" }, 403);
  if (res.status === "invalid") return c.json({ error: "INVALID_PARENT", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_PARENT", key: res.key }, 409);
  return c.json({ child_id: childId, parent_role: role }, 201);
});

// GET /individuals/{id}/pedigree — multi-generation tree (IND-01).
individualRoutes.get("/individuals/:id/pedigree", async (c) => {
  return c.json(await buildPedigree(store(c), c.req.param("id")));
});

// GET /individuals/{id}/graph — V3-UIX-82 検索グラフビュー用データ(血縁+画像類似の
// nodes/edges・決定論・都度再計算)。?top_k= で similar ノード数を調整可(既定5)。
individualRoutes.get("/individuals/:id/graph", async (c) => {
  const topK = Number(c.req.query("top_k") ?? 5);
  const graph = await projectEntityGraph(
    store(c),
    c.env.TRUTH,
    c.req.param("id"),
    Number.isFinite(topK) && topK > 0 ? Math.min(20, Math.floor(topK)) : 5,
  );
  return c.json(graph);
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
  const actorId = c.get("actorId");
  // Ownership guard (fail-closed, T-71 GAP①) — same trust boundary as
  // POST /occupancy (source-routes.ts:265): transfer-aware current owner only.
  const owner = await projectCurrentOwner(c.env.TRUTH, id);
  if (owner !== actorId) return c.json({ error: "NOT_OWNER" }, 403);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
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

// ── V3-OBS-73 データエクスポート二層 ─────────────────────────────────────────
// 「事実CSV/画像分離」の二層: facts.csv=個体の構造化事実(バイナリを含まない・
// ロックイン回避で持ち出せる)/ photos.csv=写真の参照メタのみ(media_key・
// sha256・バイナリ本体は含めない=CSV自体を軽量に保つ・実体は既存
// GET /observation/{captureId}/thumbnail/{photoId} から個別に取得)。
// grillingで確定した事項を要件へ環流させるCRフローは要件プロセス側の運用機構
// であり(データではなくドキュメント作業フロー)本ルートのスコープ外。手順は
// docs/planning/c8/requirement-cr-flow.md に formalize 済み(round-15/16裁定
// 自体がこのフローの実例)。
function csvEscape(v: string | number | null): string {
  const s = v === null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(header: string[], rows: (string | number | null)[][]): string {
  return [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n") + "\r\n";
}
function csvResponse(csv: string): Response {
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8" } });
}

// GET /export/facts.csv — 本人個体の構造化事実(画像バイナリ非含有・V3-OBS-73)。
individualRoutes.get("/export/facts.csv", async (c) => {
  const actorId = c.get("actorId");
  const s = store(c);
  const masters = (await s.listEvents(`truth/${MASTER_TYPE}/`)).map(dataOf).filter((m) => m.actor_id === actorId);
  const rows: (string | number | null)[][] = [];
  for (const m of masters) {
    const id = String(m.individual_id ?? "");
    if (!id) continue;
    rows.push([
      id,
      typeof m.local_label_text === "string" ? m.local_label_text : "",
      typeof m.species === "string" ? m.species : "",
      await projectName(s, id),
      typeof m.birth_or_hatch_date === "string" ? m.birth_or_hatch_date : "",
      typeof m.source_type === "string" ? m.source_type : "",
      typeof m.created_at === "string" ? m.created_at : "",
    ]);
  }
  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return csvResponse(
    toCsv(["individual_id", "label", "species", "name", "birth_or_hatch_date", "source_type", "created_at"], rows),
  );
});

// GET /export/photos.csv — 本人個体の写真参照のみ(バイナリ本体は含まない・
// 画像分離層・V3-OBS-73)。
individualRoutes.get("/export/photos.csv", async (c) => {
  const actorId = c.get("actorId");
  const s = store(c);
  const myIds = new Set(
    (await s.listEvents(`truth/${MASTER_TYPE}/`))
      .map(dataOf)
      .filter((m) => m.actor_id === actorId)
      .map((m) => String(m.individual_id ?? "")),
  );
  const capById = new Map<string, Record<string, unknown>>();
  for (const e of await s.listEvents(`truth/${CAPTURE_TYPE}/`)) {
    const d = dataOf(e);
    const ref = typeof d.subject_ref === "string" ? d.subject_ref : "";
    if (!ref.startsWith("individual/") || !myIds.has(ref.slice("individual/".length))) continue;
    capById.set(String(d.capture_id ?? ""), d);
  }
  const rows: (string | number | null)[][] = [];
  for (const e of await s.listEvents(`truth/${PHOTO_TYPE}/`)) {
    const d = dataOf(e);
    const capId = String(d.capture_id ?? "");
    const cap = capById.get(capId);
    if (!cap) continue; // 本人個体の capture に紐づく写真のみ(本人スコープ)
    const ref = typeof cap.subject_ref === "string" ? cap.subject_ref : "";
    rows.push([
      String(d.photo_id ?? ""),
      capId,
      ref.startsWith("individual/") ? ref.slice("individual/".length) : "",
      typeof d.media_key === "string" ? d.media_key : "",
      typeof d.content_type === "string" ? d.content_type : "",
      typeof d.size_bytes === "number" ? d.size_bytes : null,
      typeof d.sha256 === "string" ? d.sha256 : "",
    ]);
  }
  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return csvResponse(
    toCsv(["photo_id", "capture_id", "individual_id", "media_key", "content_type", "size_bytes", "sha256"], rows),
  );
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

// POST /individuals/{id}/lineage-doubt — 購入者が血統説明の矛盾に疑義を記録する
// (V3-IND-21・「取引出品文の血統説明に矛盾がないか照合して疑義を購入者が確認・
// 記録できる文化」)。汎用 market-flag(出品自体の違法性通報・GOV-35)とは別の
// 専用route——血統/真正性の疑義は GET .../authenticity の doubts[] に集約表示
// される。append-only: action="withdrawn" は元の raised レコードを消さず、同じ
// doubt_id で新規追記する(不変条項③)。
// Raiser guard (fail-closed, T-71 GAP②/SEC-A2): action="withdrawn" is limited to
// the actor who raised the doubt_id being withdrawn — a third party knowing the
// doubt_id must not be able to make someone else's doubt appear withdrawn.
individualRoutes.post("/individuals/:id/lineage-doubt", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");
  const action = body.action === "withdrawn" ? "withdrawn" : "raised";
  if (action === "raised" && (typeof body.reason !== "string" || !body.reason.trim())) {
    return c.json({ error: "REASON_REQUIRED" }, 400);
  }
  const s = store(c);
  if (action === "withdrawn") {
    // Oldest raised row = the original raiser (doubt_id is client-chosen on
    // raise, so an attacker can re-raise the SAME doubt_id after the victim —
    // taking "latest raised" as raiser lets the attacker's own withdrawn pass.
    // created_at is server-stamped monotonic nowIso(), so raisedRows[0] after
    // this explicit ascending sort is always the true first raiser).
    const raisedRows = (await s.listEvents(`truth/${LINEAGE_DOUBT_TYPE}/${id}-`))
      .map(dataOf)
      .filter((d) => d.individual_id === id && d.doubt_id === body.doubt_id && d.action === "raised")
      .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
    const raiser = raisedRows[0]?.actor_id;
    if (raiser !== actorId) return c.json({ error: "FORBIDDEN", details: ["raiser only"] }, 403);
  }
  const doubtId = typeof body.doubt_id === "string" && body.doubt_id ? body.doubt_id : ulid();
  const data: Record<string, unknown> = {
    doubt_id: doubtId,
    individual_id: id,
    action,
    actor_id: actorId,
    created_at: nowIso(),
  };
  if (typeof body.reason === "string" && body.reason.trim()) data.reason = body.reason;
  if (typeof body.listing_id === "string" && body.listing_id) data.listing_id = body.listing_id;
  const res = await s.putEventAt(
    `truth/${LINEAGE_DOUBT_TYPE}/${id}-${ulid()}.json`,
    envelope(LINEAGE_DOUBT_TYPE, SCHEMA.lineageDoubt, actorId, data),
  );
  if (res.status === "invalid") return c.json({ error: "INVALID_LINEAGE_DOUBT", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_LINEAGE_DOUBT", key: res.key }, 409);
  return c.json({ individual_id: id, doubt_id: doubtId, action }, 201);
});

// Shared life-event append (IND-12/13), reused by batch-commit kind:"life-event"
// (コピペ二重化しない — F4 行メニュー/一括どちらも同じ append 経路)。
// Ownership guard (fail-closed, T-71 GAP①): same projectCurrentOwner trust
// boundary as POST /occupancy — covers BOTH entry points (direct route below
// and batch-commit-routes.ts kind:"life-event") since both funnel through here.
export async function writeLifeEvent(
  bucket: R2BucketLite,
  s: TruthStore,
  actorId: string,
  individualId: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; individual_id: string; kind: unknown } | { ok: false; error: string; details?: string[] }> {
  const owner = await projectCurrentOwner(bucket, individualId);
  if (owner !== actorId) return { ok: false, error: "NOT_OWNER" };
  const data: Record<string, unknown> = {
    individual_id: individualId,
    kind: body.kind,
    at: body.at,
    actor_id: actorId,
    created_at: nowIso(),
  };
  if (body.detail !== undefined) data.detail = body.detail;
  const res = await s.putEventAt(
    `truth/${LIFE_TYPE}/${individualId}-${ulid()}.json`,
    envelope(LIFE_TYPE, SCHEMA.life, actorId, data),
  );
  if (res.status === "invalid") return { ok: false, error: "INVALID_LIFE_EVENT", details: res.errors };
  if (res.status === "conflict") return { ok: false, error: "DUPLICATE_LIFE_EVENT" };
  return { ok: true, individual_id: individualId, kind: body.kind };
}

// POST /individuals/{id}/life-events — append a life milestone (IND-12/13).
individualRoutes.post("/individuals/:id/life-events", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");
  const r = await writeLifeEvent(c.env.TRUTH, store(c), actorId, id, body);
  if (!r.ok) {
    const status = r.error === "NOT_OWNER" ? 403 : r.error === "DUPLICATE_LIFE_EVENT" ? 409 : 400;
    return c.json({ error: r.error, details: r.details }, status);
  }
  return c.json({ individual_id: r.individual_id, kind: r.kind }, 201);
});

// POST /individuals/{id}/schedule/generate — 「スケジュール自動生成」ボタン
// (V3-IND-20)。現在の成長ステージ(直近 molt から自動検出・deriveCurrentStage)
// を毎回手入力させず、既存の決定論 stage 間隔(SCHEDULE_STAGE_INTERVAL_DAYS・
// computeNextObservationAt/home-routes.ts)から次回観測予定を1件 INSERT する
// (POST /observation/schedule と同じ Truth 形・コピペ二重化しない)。LLM/常駐AI
// は使わない(不変条項①)——「AI」は種族・ステージ・履歴からの決定論導出を指す。
// ステージ未確定(まだ molt 記録なし)は 400 STAGE_UNKNOWN(推測しない・誇張ゼロ)。
individualRoutes.post("/individuals/:id/schedule/generate", async (c) => {
  const id = c.req.param("id");
  const s = store(c);
  const actorId = c.get("actorId");
  // Ownership guard (fail-closed, T-71 GAP①) — same trust boundary as
  // POST /occupancy (source-routes.ts:265): transfer-aware current owner only.
  const owner = await projectCurrentOwner(c.env.TRUTH, id);
  if (owner !== actorId) return c.json({ error: "NOT_OWNER" }, 403);
  const life = (await s.listEvents(`truth/${LIFE_TYPE}/${id}-`))
    .map(dataOf)
    .filter((d) => d.individual_id === id)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const stage = deriveCurrentStage(life);
  if (!stage) return c.json({ error: "STAGE_UNKNOWN" }, 400);
  // stage(life-event の to_stage 語彙: first/second/…)→ SCHEDULE_STAGE_INTERVAL_DAYS
  // の遷移キー(first_to_second/…)へ変換。まだ例示値が無い段階(third_early 以降)
  // は 400(未知の間隔を推測しない)。
  const transitionKey = STAGE_TO_NEXT_TRANSITION[stage];
  if (!transitionKey) return c.json({ error: "NO_INTERVAL_FOR_STAGE", stage }, 400);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const from = typeof body.from === "string" ? body.from : nowIso();
  const nextAt = computeNextObservationAt(undefined, transitionKey, from);
  if (nextAt === null) return c.json({ error: "NO_INTERVAL_FOR_STAGE", stage }, 400);
  const scheduleId = ulid();
  const data: Record<string, unknown> = {
    schedule_id: scheduleId,
    individual_id: id,
    next_observation_at: nextAt,
    stage: transitionKey,
    actor_id: actorId,
    created_at: nowIso(),
  };
  const res = await s.putEventAt(
    `truth/${SCHEDULE_TYPE}/${id}-${scheduleId}.json`,
    envelope(SCHEDULE_TYPE, "schemas/events/obs-schedule.schema.json", actorId, data),
  );
  if (res.status === "invalid") return c.json({ error: "INVALID_SCHEDULE", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_SCHEDULE", key: res.key }, 409);
  return c.json(
    { individual_id: id, schedule_id: scheduleId, detected_stage: stage, stage: transitionKey, next_observation_at: nextAt },
    201,
  );
});
