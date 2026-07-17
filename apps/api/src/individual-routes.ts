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
// cross-module read-only types (owned by observation / market / source packages).
const CAPTURE_TYPE = "ihl.obs.capture.v1";
const PHOTO_TYPE = "ihl.obs.photo.v1";
const SCHEDULE_TYPE = "ihl.obs.schedule.v1";
const DEVICE_TYPE = "ihl.obs.device.v1";
const OCCUPANCY_TYPE = "ihl.src.occupancy.v1";

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
  const molts = life.filter((d) => d.kind === "molt");
  const latestMolt = molts[molts.length - 1];
  const stage =
    latestMolt && typeof latestMolt.detail === "object" && latestMolt.detail !== null
      ? ((latestMolt.detail as Record<string, unknown>).to_stage as string | undefined) ?? null
      : null;

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
  },
): Promise<{ individualId: string; res: Awaited<ReturnType<TruthStore["putEventAt"]>> }> {
  const individualId =
    typeof fields.individual_id === "string" && fields.individual_id ? fields.individual_id : ulid();
  const data: Record<string, unknown> = {
    individual_id: individualId,
    actor_id: actorId,
    created_at: nowIso(),
  };
  for (const k of ["local_label_text", "species", "birth_or_hatch_date", "source_type"] as const) {
    if (fields[k] !== undefined) data[k] = fields[k];
  }
  const res = await s.putEventAt(
    `truth/${MASTER_TYPE}/${individualId}.json`,
    envelope(MASTER_TYPE, SCHEMA.master, actorId, data),
  );
  return { individualId, res };
}

// Shared blood-link logic (IND-01/12), reused by clutch promote to inherit
// sire_id/dam_id (コピペ二重化しない). Same key/conflict semantics as the route.
export async function linkParent(
  s: TruthStore,
  actorId: string,
  childId: string,
  parentId: string,
  role: string,
): Promise<Awaited<ReturnType<TruthStore["putEventAt"]>>> {
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
  const sortKey = c.req.query("sort") ?? "";
  const sortOrder = c.req.query("order") === "asc" ? 1 : -1; // 既定 desc(新しい/多い/大きい順)
  const s = store(c);
  const masters = (await s.listEvents(`truth/${MASTER_TYPE}/`))
    .map(dataOf)
    .filter((m) => m.actor_id === actorId);
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
    individuals.push({
      individual_id: id,
      label: label || name || id,
      name,
      species: species || null,
      last_capture_at: latest ? latest.time || null : null,
      last_measurement_summary: latest ? representativeMeasurement(latest.data) : null,
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
  const res = await linkParent(store(c), actorId, childId, String(body.parent_id), String(role));
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

// ── V3-OBS-73 データエクスポート二層 ─────────────────────────────────────────
// 「事実CSV/画像分離」の二層: facts.csv=個体の構造化事実(バイナリを含まない・
// ロックイン回避で持ち出せる)/ photos.csv=写真の参照メタのみ(media_key・
// sha256・バイナリ本体は含めない=CSV自体を軽量に保つ・実体は既存
// GET /observation/{captureId}/thumbnail/{photoId} から個別に取得)。
// grillingで確定した事項を要件へ環流させるCRフローは要件プロセス側の運用機構
// であり(データではなくドキュメント作業フロー)本ルートのスコープ外
// (誇張ゼロ: 未着手をここに書かない)。
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

// Shared life-event append (IND-12/13), reused by batch-commit kind:"life-event"
// (コピペ二重化しない — F4 行メニュー/一括どちらも同じ append 経路)。
export async function writeLifeEvent(
  s: TruthStore,
  actorId: string,
  individualId: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; individual_id: string; kind: unknown } | { ok: false; error: string; details?: string[] }> {
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
  const r = await writeLifeEvent(store(c), actorId, id, body);
  if (!r.ok) return c.json({ error: r.error, details: r.details }, r.error === "DUPLICATE_LIFE_EVENT" ? 409 : 400);
  return c.json({ individual_id: r.individual_id, kind: r.kind }, 201);
});
