// C5 K5 Project Hub / Ver 分岐 / bestVersion / citation / 再解析マニフェスト / bundle
// (design-k5 §2.1/§2.3 / V3-PPR-16/18/09)。PPR-16 の 100 番台分離モジュール。
// 全 route は index.ts §1.5 gate 経由 PROTECTED（deny-by-default: PUBLIC_ROUTES に載せない）。
// 書込 actor_id はセッション principal 強制（envelope.provenance.actor_id・V3-AUT-17）。投影は
// 都度再計算（常駐 DB 禁止・不変条項①）で prefix scan（proposal/ledger と同じ）。付与関数は
// ledger-routes.ts の grantPlatinum を再利用（再実装しない・懲罰関数 grantKarmaCountIncrease は呼ばない）。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { CONTRIBUTION_POINTS_PER_CITATION } from "./research-constants";
import { grantPlatinum } from "./ledger-routes";

export const projectRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const PROJECT_TYPE = "ihl.research.project.v1";
const PROJECT_SCHEMA = "schemas/events/project.schema.json";
const CITATION_TYPE = "ihl.research.citation.v1";
const CITATION_SCHEMA = "schemas/events/citation.schema.json";
const CONTENT_TYPE = "ihl.research.content.v1";
const OBS_PHOTO_TYPE = "ihl.obs.photo.v1";
const OBS_ANALYSIS_TYPE = "ihl.obs.analysis.v1";
const SCHEMA_VERSION = "1";

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}
function projectKey(id: string): string {
  return `truth/${PROJECT_TYPE}/${id}.json`;
}
function contentKey(id: string): string {
  return `truth/${CONTENT_TYPE}/${id}.json`;
}
function citationKey(id: string): string {
  return `truth/${CITATION_TYPE}/${id}.json`;
}
function envelope(type: string, schema: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id: ulid(), // §2.2: envelope.id は毎回 ULID。決定論エンティティ ID は storage key 側だけに使う。
    source: "apps/api",
    type,
    time: new Date().toISOString(),
    dataschema: schema,
    provenance: { generator_kind: "human", actor_id: actorId }, // V3-AUT-17 session principal 強制。
    data,
  };
}
// citation storage key / citation_id 用の SHA-1 hex（WebCrypto のみ・新規依存なし・cusb-routes と同流儀）。
async function sha1hex(input: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── projectHub 投影（PPR-16・都度再計算）───────────────────────────────────────
// project 本体 + projectId で束ねた content(project_id)・その content への citation・子 Ver
// (parent_project_id) を集約。market listing / observation(subject_ref) / task_node は現行
// スキーマに project 直接リンクが無いため本投影では束ねない。
// ponytail: content/citation/version の 3 軸のみ集約。market/observation/task を project へ束ねるには
// それぞれのスキーマに project_id 参照を足す必要があり（今は無い）、リンクが入った波で拡張する。
export interface ProjectHub {
  project: Record<string, unknown>;
  contents: Record<string, unknown>[];
  citations: Record<string, unknown>[];
  versions: Record<string, unknown>[];
}

export async function projectHub(s: TruthStore, projectId: string): Promise<ProjectHub | null> {
  const projectEv = await s.readEvent(projectKey(projectId));
  if (!projectEv) return null;
  const project = dataOf(projectEv);

  const contents = (await s.listEvents(`truth/${CONTENT_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.project_id === projectId)
    .sort((a, b) => String(a.content_id).localeCompare(String(b.content_id)));
  const contentIds = new Set(contents.map((c) => String(c.content_id)));

  const citations = (await s.listEvents(`truth/${CITATION_TYPE}/`))
    .map(dataOf)
    .filter((d) => contentIds.has(String(d.content_id)))
    .sort((a, b) => String(a.citation_id).localeCompare(String(b.citation_id)));

  const versions = (await s.listEvents(`truth/${PROJECT_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.parent_project_id === projectId)
    .sort((a, b) => String(a.project_id).localeCompare(String(b.project_id)));

  return { project, contents, citations, versions };
}

// ── bestVersion 投影（PPR-16・決定論選定）──────────────────────────────────────
// project 家系（parent_project_id 無向グラフの連結成分）を辿り、各 Ver に紐づく観測
// (content.project_id が持つ measurements の数値平均＝成長指標平均) をスコア化 → 最高スコア Ver を選定。
// 同点は version_label(=title) 昇順、なお同点は project_id 昇順で決定論。
// ponytail: スコアは Ver 粒度（lot 別ではない）。lot 別集計には観測に lot_id タグが要るが content/obs
// スキーマに lot リンクが無いため、各 Ver の宣言 lots は出力に載せるだけ。lot タグ導入時に lot 粒度へ上げる。
export interface VersionScore {
  project_id: string;
  version_label: string;
  parent_project_id?: string;
  score: number;
  observation_count: number;
  lots: unknown[];
}
export interface BestVersionResult {
  project_id: string;
  versions: VersionScore[];
  best_version: VersionScore | null;
}

export async function bestVersion(s: TruthStore, projectId: string): Promise<BestVersionResult | null> {
  const projects = (await s.listEvents(`truth/${PROJECT_TYPE}/`)).map(dataOf);
  const byId = new Map(projects.map((p) => [String(p.project_id), p]));
  if (!byId.has(projectId)) return null;

  // 無向 BFS で家系（親↔子）の連結成分を集める。
  const family = new Set<string>();
  const queue = [projectId];
  while (queue.length) {
    const cur = queue.shift() as string;
    if (family.has(cur) || !byId.has(cur)) continue;
    family.add(cur);
    const p = byId.get(cur) as Record<string, unknown>;
    if (typeof p.parent_project_id === "string") queue.push(p.parent_project_id);
    for (const q of projects) {
      if (q.parent_project_id === cur) queue.push(String(q.project_id));
    }
  }

  const contents = (await s.listEvents(`truth/${CONTENT_TYPE}/`)).map(dataOf);

  const versions: VersionScore[] = [];
  for (const vid of family) {
    const p = byId.get(vid) as Record<string, unknown>;
    const tied = contents.filter((c) => c.project_id === vid);
    const values: number[] = [];
    for (const c of tied) {
      for (const m of (Array.isArray(c.measurements) ? c.measurements : []) as Record<string, unknown>[]) {
        const v = Number(m.value);
        if (Number.isFinite(v)) values.push(v);
      }
    }
    const score = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    versions.push({
      project_id: vid,
      version_label: String(p.title ?? vid),
      ...(typeof p.parent_project_id === "string" ? { parent_project_id: p.parent_project_id } : {}),
      score,
      observation_count: values.length,
      lots: Array.isArray(p.lots) ? (p.lots as unknown[]) : [],
    });
  }
  versions.sort(
    (a, b) =>
      b.score - a.score ||
      a.version_label.localeCompare(b.version_label) ||
      a.project_id.localeCompare(b.project_id),
  );
  // 観測が 1 件も無い Ver は選定候補から外す（成長指標が無いため）。
  const best = versions.find((v) => v.observation_count > 0) ?? null;
  return { project_id: projectId, versions, best_version: best };
}

// ── reanalysisManifest / bundle 投影（PPR-09・事実キーのみ・画像バイナリ非含）───────
// content が引用する観測セッション(cited_session_ids=capture_id)の obs-photo/obs-analysis から
// 再現に必要な事実キーのみ集約: imageR2Key(media_key)/input_hash(sha256)/run_id(analysis_id)/
// scaleTemplateId・bpcmsEngineProfile(analysis.results 自由項 or correction_semver)。画像バイナリ
// (media/photo/*) は一切読まない＝キー文字列だけ。sessions/facts を昇順ソートし同一入力同一結果を保証。
export interface ReanalysisFact {
  capture_id: string;
  imageR2Key?: string;
  scaleTemplateId?: string;
  bpcmsEngineProfile?: string;
  run_id?: string;
  input_hash?: string;
}
export interface ReanalysisManifest {
  content_id: string;
  committed_at: string; // envelope.time（PPR-09: observed_at と分離）
  sessions: string[];
  facts: ReanalysisFact[];
}

function firstStr(...vals: unknown[]): string | undefined {
  for (const v of vals) if (typeof v === "string" && v) return v;
  return undefined;
}

export async function reanalysisManifest(s: TruthStore, contentId: string): Promise<ReanalysisManifest | null> {
  const ev = await s.readEvent(contentKey(contentId));
  if (!ev) return null;
  const data = dataOf(ev);
  const sessions = (Array.isArray(data.cited_session_ids) ? data.cited_session_ids : []).map(String).sort();

  const facts: ReanalysisFact[] = [];
  for (const capture_id of sessions) {
    const photos = (await s.listEvents(`truth/${OBS_PHOTO_TYPE}/${capture_id}-`))
      .map(dataOf)
      .sort((a, b) => String(a.photo_id).localeCompare(String(b.photo_id)));
    const analyses = (await s.listEvents(`truth/${OBS_ANALYSIS_TYPE}/${capture_id}-`))
      .map(dataOf)
      .sort((a, b) => String(a.analysis_id).localeCompare(String(b.analysis_id)));
    const photo = photos[0] ?? {};
    const a = analyses[0] ?? {};
    const r = (a.results ?? {}) as Record<string, unknown>;

    const fact: ReanalysisFact = { capture_id };
    const imageR2Key = firstStr(photo.media_key, r.imageR2Key);
    const scaleTemplateId = firstStr(r.scaleTemplateId);
    const bpcmsEngineProfile = firstStr(r.bpcmsEngineProfile, a.correction_semver);
    const run_id = firstStr(r.run_id, a.analysis_id);
    const input_hash = firstStr(photo.sha256, r.input_hash);
    if (imageR2Key) fact.imageR2Key = imageR2Key;
    if (scaleTemplateId) fact.scaleTemplateId = scaleTemplateId;
    if (bpcmsEngineProfile) fact.bpcmsEngineProfile = bpcmsEngineProfile;
    if (run_id) fact.run_id = run_id;
    if (input_hash) fact.input_hash = input_hash;
    facts.push(fact);
  }
  facts.sort((a, b) => a.capture_id.localeCompare(b.capture_id));
  return { content_id: contentId, committed_at: String(ev.time ?? ""), sessions, facts };
}

export interface Bundle extends ReanalysisManifest {
  observed_at: string | null; // data 側の観測時刻（committed_at と分離・PPR-09）
  sections: unknown;
  measurements: Record<string, unknown>[]; // 各行 value_origin 付き（frozen provenance 9 値）
}

export async function bundle(s: TruthStore, contentId: string): Promise<Bundle | null> {
  const ev = await s.readEvent(contentKey(contentId));
  if (!ev) return null;
  const data = dataOf(ev);
  const manifest = (await reanalysisManifest(s, contentId)) as ReanalysisManifest;
  return {
    ...manifest,
    observed_at: typeof data.observed_at === "string" ? data.observed_at : null,
    sections: data.sections ?? null,
    measurements: (Array.isArray(data.measurements) ? data.measurements : []) as Record<string, unknown>[],
  };
}

// ── routes ─────────────────────────────────────────────────────────────────────

// POST /research/projects — project 作成（INSERT ONLY・同一 project_id 再 put=409・PPR-16）。
projectRoutes.post("/research/projects", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");
  const projectId = typeof body.project_id === "string" && body.project_id ? body.project_id : ulid();
  const data: Record<string, unknown> = {
    project_id: projectId,
    actor_id: actorId, // V3-AUT-17 強制刻印（クライアント指定は無視）
    title: body.title,
    created_at: typeof body.created_at === "string" ? body.created_at : new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  for (const k of ["lots", "links", "contributors", "parent_project_id", "parent_version_label"] as const) {
    if (body[k] !== undefined) data[k] = body[k];
  }
  const res = await store(c).putEventAt(projectKey(projectId), envelope(PROJECT_TYPE, PROJECT_SCHEMA, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_PROJECT", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_PROJECT", key: res.key }, 409);
  return c.json({ project_id: projectId, key: res.key }, 201);
});

// GET /research/projects — 一覧投影（project_id 昇順決定論・PPR-16）。
projectRoutes.get("/research/projects", async (c) => {
  const items = (await store(c).listEvents(`truth/${PROJECT_TYPE}/`))
    .map(dataOf)
    .sort((a, b) => String(a.project_id).localeCompare(String(b.project_id)));
  return c.json({ items });
});

// GET /research/projects/:id — project hub 集約投影（PPR-16）。
projectRoutes.get("/research/projects/:id", async (c) => {
  const hub = await projectHub(store(c), c.req.param("id"));
  if (!hub) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
  return c.json(hub);
});

// POST /research/projects/:id/versions — Ver 分岐（parent_project_id を持つ新 project row・PPR-16）。
// 別スキーマ不要＝同じ project スキーマに parent_project_id / parent_version_label を刻んで append。
projectRoutes.post("/research/projects/:id/versions", async (c) => {
  const parentId = c.req.param("id");
  const actorId = c.get("actorId");
  const parentEv = await store(c).readEvent(projectKey(parentId));
  if (!parentEv) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
  const parent = dataOf(parentEv);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const newId = typeof body.project_id === "string" && body.project_id ? body.project_id : ulid();
  const data: Record<string, unknown> = {
    project_id: newId,
    actor_id: actorId,
    title: body.title ?? body.version_label ?? parent.title,
    parent_project_id: parentId,
    parent_version_label: typeof body.parent_version_label === "string" ? body.parent_version_label : String(parent.title ?? ""),
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  for (const k of ["lots", "links", "contributors"] as const) if (body[k] !== undefined) data[k] = body[k];
  const res = await store(c).putEventAt(projectKey(newId), envelope(PROJECT_TYPE, PROJECT_SCHEMA, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_PROJECT", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_PROJECT", key: res.key }, 409);
  return c.json({ project_id: newId, parent_project_id: parentId }, 201);
});

// GET /research/projects/:id/best-version — Ver/lot 別観測集計 → 決定論選定（PPR-16）。
projectRoutes.get("/research/projects/:id/best-version", async (c) => {
  const res = await bestVersion(store(c), c.req.param("id"));
  if (!res) return c.json({ error: "PROJECT_NOT_FOUND" }, 404);
  return c.json(res);
});

// POST /research/citations — 引用/データ提供の append-only 記録 + 貢献ポイント報酬（PPR-18）。
// storage key = sha1(content|provider|session|status|snapshot)＝同一提供の再 put は 409（冪等）、
// 不足キー充足の status=updated は別 snapshot ＝ 別キーで append（UPDATE 禁止・不変条項③）。
// 報酬は grantPlatinum(...,"contribution_rebate") のみ（懲罰関数 grantKarmaCountIncrease は呼ばない）。
// platinum は spendable かつ提案昇格の投票重みを持つ通貨。付与額と受取人を両方クライアントが選べ
// ると無制限鋳造になるため（批評家 major）: (1) 付与額はサーバ固定（body.contribution_points は
// 無視）(2) 自己引用（provider == 呼び手）は自己報酬発券口なので拒否。
projectRoutes.post("/research/citations", async (c) => {
  const actorId = c.get("actorId");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const content_id = typeof body.content_id === "string" ? body.content_id : "";
  const provider = typeof body.provider_actor_id === "string" ? body.provider_actor_id : "";
  const session = typeof body.source_session_id === "string" ? body.source_session_id : "";
  if (!content_id || !provider || !session) {
    return c.json({ error: "INVALID_CITATION", details: ["content_id, provider_actor_id, source_session_id required"] }, 400);
  }
  // 自己引用禁止（自分を provider に立てて自分に platinum を鋳造できない）。
  if (provider === actorId) {
    return c.json({ error: "SELF_CITATION", details: ["provider_actor_id must differ from the session principal"] }, 400);
  }
  const status = body.status === "updated" ? "updated" : "provided";
  // 報酬額はサーバが決定（クライアント body.contribution_points は信用しない）。1 引用イベント =
  // CONTRIBUTION_POINTS_PER_CITATION 固定・status=updated の追記も同額。
  // ponytail: session は署名付きステートレスで所有者照合先の常駐 store が無いため、鋳造の残余ベクトル
  // （共謀ペアが session_id を変えて他人へ 1pt ずつ farm）は自己引用禁止＋固定額で最小化に留める。
  // session 台帳が入った波で provider の source_session_id 所有を検証して閉じる。
  const points = CONTRIBUTION_POINTS_PER_CITATION;
  const anonymous = body.anonymous === true;
  const snapshot = Array.isArray(body.match_snapshot) ? body.match_snapshot.map(String) : [];

  const citation_id = await sha1hex([content_id, provider, session].join("|"));
  const storageId = await sha1hex([content_id, provider, session, status, ...snapshot].join("|"));
  const data: Record<string, unknown> = {
    citation_id,
    content_id,
    provider_actor_id: provider,
    source_session_id: session,
    contribution_points: points,
    anonymous,
    status,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (snapshot.length) data.match_snapshot = snapshot;

  const res = await store(c).putEventAt(citationKey(storageId), envelope(CITATION_TYPE, CITATION_SCHEMA, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_CITATION", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_CITATION", key: res.key }, 409);
  // 新規 insert 時のみ貢献ポイントをプラチナ功績章としてデータ提供者へ付与（PPR-18・批評家 major#2）。
  await grantPlatinum(store(c), provider, points, "contribution_rebate");
  return c.json({ citation_id, status, contribution_points: points }, 201);
});

// GET /research/content/:id/reanalysis-manifest — 事実キーのみの再解析マニフェスト投影（PPR-09）。
projectRoutes.get("/research/content/:id/reanalysis-manifest", async (c) => {
  const m = await reanalysisManifest(store(c), c.req.param("id"));
  if (!m) return c.json({ error: "CONTENT_NOT_FOUND" }, 404);
  return c.json(m);
});

// GET /research/content/:id/bundle — manifest + sections + measurements(value_origin) の 1 束投影（PPR-09）。
projectRoutes.get("/research/content/:id/bundle", async (c) => {
  const b = await bundle(store(c), c.req.param("id"));
  if (!b) return c.json({ error: "CONTENT_NOT_FOUND" }, 404);
  return c.json(b);
});
