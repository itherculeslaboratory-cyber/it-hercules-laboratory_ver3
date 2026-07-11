// C5 K5 研究エージェントバッチ（design-k5 §2.1/§2.3 / V3-PPR-17・V3-WIK-01）。日次蒸留 +
// タスク生成 + 新聞生成の単発手動トリガ（POST /research/agent/run）と、Cloudflare Workers の
// scheduled ハンドラ実体（handleResearchScheduled）を提供する。全生成物は決定論キー(sha1)で
// append（同一入力→同一ノード・冪等・put-if-absent = storage 層 409）。掲示板/論文 →
// board_summary → big_wiki の階層。新聞は content_type=newspaper で content に格納（別スキーマ不要）。
// LLM 助言は既定 OFF でスキップ（不変条項①・実鍵投入は §6 人間ゲート）。投影は都度再計算（常駐 DB 禁止）。
// 【Cron 定期配線（wrangler.toml [triggers] crons）は §6 人間ゲート】: 本体 + 手動 route までを納品。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { DIFFICULTY } from "./research-constants";

export const researchAgentBatchRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const TASK_TYPE = "ihl.research.task_node.v1";
const TASK_SCHEMA = "schemas/events/task-node.schema.json";
const WIKI_TYPE = "ihl.research.wiki_node.v1";
const WIKI_SCHEMA = "schemas/events/wiki-node.schema.json";
const CONTENT_TYPE = "ihl.research.content.v1";
const CONTENT_SCHEMA = "schemas/events/content.schema.json";
const SCHEMA_VERSION = "1";
// バッチ生成物（新聞 content の actor_id 等）の系統 actor。手動 route は session principal を使う。
const SYSTEM_ACTOR = "system:research-batch";

type SourceKind = "limitation" | "next_question" | "data_gap" | "failure_cluster" | "complaint_cluster";
type Difficulty = (typeof DIFFICULTY)[number];

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}
// SHA-1 hex（WebCrypto のみ・新規依存なし・project-routes/cusb-routes と同流儀）。決定論エンティティ ID 用。
async function sha1hex(input: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// 節本文/主張文は任意文字を含みうる。content.schema の body_markdown/summary は LaTeX 禁止
// (^[^\\$]*$) なので、生成テキストからは \ と $ を除去する（PPR-03）。
function stripLatex(s: string): string {
  return s.replace(/[\\$]/g, "");
}
function normalizeQuestion(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

function agentEnvelope(type: string, schema: string, data: Record<string, unknown>, time: string) {
  return {
    specversion: "1.0",
    id: ulid(), // §2.2: envelope.id は毎回 ULID。決定論キー(task_id/node_id/content_id)は storage key 側のみ。
    source: "apps/api",
    type,
    time,
    dataschema: schema,
    provenance: { generator_kind: "agent", agent_name: "claude-code" },
    data,
  };
}
function humanEnvelope(type: string, schema: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id: ulid(),
    source: "apps/api",
    type,
    time: new Date().toISOString(),
    dataschema: schema,
    provenance: { generator_kind: "human", actor_id: actorId }, // V3-AUT-17 session principal 強制。
    data,
  };
}

function taskKey(taskId: string): string {
  return `truth/${TASK_TYPE}/${taskId}.json`;
}
function wikiKey(nodeId: string): string {
  return `truth/${WIKI_TYPE}/${nodeId}.json`;
}
function contentKey(contentId: string): string {
  return `truth/${CONTENT_TYPE}/${contentId}.json`;
}

// ── 難易度/優先度ヒューリスティック（決定論・PPR-17）─────────────────────────────
// difficulty: 問い文長で 3 段（短=beginner / 中=intermediate / 長=researcher）。
// priority: source_kind 別ベース + 問い文長の微加算（0–100 clamp）。「較正は GUI 後波」の初期値。
const PRIORITY_BASE: Record<SourceKind, number> = {
  failure_cluster: 80,
  limitation: 70,
  data_gap: 60,
  complaint_cluster: 50,
  next_question: 40,
};
function difficultyFor(question: string): Difficulty {
  const n = question.length;
  if (n < 40) return "beginner";
  if (n < 120) return "intermediate";
  return "researcher";
}
function priorityFor(kind: SourceKind, question: string): number {
  return Math.min(100, PRIORITY_BASE[kind] + Math.min(20, Math.floor(question.length / 10)));
}

// task_id = sha1(source_kind|source_ref|normalized_question) → 同一入力で同一ノード（冪等）。
async function taskId(kind: SourceKind, sourceRef: string, question: string): Promise<string> {
  return sha1hex(`${kind}|${sourceRef}|${normalizeQuestion(question)}`);
}

async function appendTask(
  s: TruthStore,
  kind: SourceKind,
  sourceRef: string,
  question: string,
  now: Date,
  extra?: { difficulty?: Difficulty; priority?: number; program_id?: string; actorId?: string },
): Promise<{ task_id: string; inserted: boolean }> {
  const id = await taskId(kind, sourceRef, question);
  const data: Record<string, unknown> = {
    task_id: id,
    question,
    source_kind: kind,
    source_ref: sourceRef,
    difficulty: extra?.difficulty ?? difficultyFor(question),
    priority: extra?.priority ?? priorityFor(kind, question),
    created_at: now.toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (extra?.program_id) data.program_id = extra.program_id;
  const env = extra?.actorId
    ? humanEnvelope(TASK_TYPE, TASK_SCHEMA, extra.actorId, data)
    : agentEnvelope(TASK_TYPE, TASK_SCHEMA, data, now.toISOString());
  const res = await s.putEventAt(taskKey(id), env);
  return { task_id: id, inserted: res.status === "inserted" };
}

// ── generateTaskNodes（PPR-17）──────────────────────────────────────────────────
// research content（paper）を走査し、決定論タスクを append する:
//   - sections.gap（filled）      → limitation
//   - claims[status=hypothesis]   → next_question
//   - required 条件キー − 計測キー → data_gap
// 同一 limitations 入力 → 同一 task_id（sha1 決定論）で冪等。新規 insert 件数を返す。
// ponytail: 源は content 由来の 3 種のみ実装。failure_cluster/complaint_cluster は評価/苦情
// フィードが配線された波で足す（今その供給源が無い）— source_kind enum 自体は全対応済み。
export async function generateTaskNodes(s: TruthStore, now: Date): Promise<number> {
  const papers = (await s.listEvents(`truth/${CONTENT_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.content_type === "paper")
    .sort((a, b) => String(a.content_id).localeCompare(String(b.content_id)));
  let created = 0;
  for (const p of papers) {
    const contentId = String(p.content_id);
    const sections = (p.sections ?? {}) as Record<string, { filled?: boolean; text?: string }>;
    const gap = sections.gap;
    if (gap?.filled && typeof gap.text === "string" && gap.text.trim()) {
      const r = await appendTask(s, "limitation", contentId, gap.text.trim(), now);
      if (r.inserted) created++;
    }
    for (const claim of (Array.isArray(p.claims) ? p.claims : []) as Record<string, unknown>[]) {
      if (claim.status === "hypothesis" && typeof claim.statement === "string" && claim.statement.trim()) {
        const r = await appendTask(s, "next_question", contentId, claim.statement.trim(), now);
        if (r.inserted) created++;
      }
    }
    // data_gap: required 条件キーのうち計測が無いもの。
    const conditions = (p.conditions ?? {}) as Record<string, { required?: boolean }>;
    const measuredItems = new Set(
      ((Array.isArray(p.measurements) ? p.measurements : []) as Record<string, unknown>[]).map((m) => String(m.item)),
    );
    for (const key of Object.keys(conditions).sort()) {
      if (conditions[key]?.required && !measuredItems.has(key)) {
        const r = await appendTask(s, "data_gap", contentId, `Missing required measurement for ${key}`, now);
        if (r.inserted) created++;
      }
    }
  }
  return created;
}

// ── distillWiki（WIK-01）────────────────────────────────────────────────────────
// 掲示板/論文 → board_summary → big_wiki の階層を決定論 append する。board = project_id（無ければ
// content 自身が 1 掲示板＝scope_ref=content_id）。node_id = sha1(level|scope_ref|content_hash) →
// 同一入力で同一ノード（冪等・append-only）。LLM 助言は既定 OFF でスキップ（enrich は実鍵ゲート・
// §6）— 決定論の中核は OFF でも常に走る。返り値の llm_calls は OFF なら常に 0。
export interface DistillReport {
  board_summaries: number;
  big_wikis: number;
  llm_calls: number;
}

export async function distillWiki(s: TruthStore, now: Date, llmMode = "off"): Promise<DistillReport> {
  const contents = (await s.listEvents(`truth/${CONTENT_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.content_type !== "newspaper") // 自己生成の新聞は再蒸留しない
    .sort((a, b) => String(a.content_id).localeCompare(String(b.content_id)));

  // board グルーピング: project_id があればそれ、無ければ content 自身。
  const boards = new Map<string, Record<string, unknown>[]>();
  for (const c of contents) {
    const boardKey = typeof c.project_id === "string" && c.project_id ? c.project_id : String(c.content_id);
    const bucket = boards.get(boardKey) ?? [];
    bucket.push(c);
    boards.set(boardKey, bucket);
  }

  let board_summaries = 0;
  for (const boardKey of [...boards.keys()].sort()) {
    const members = boards.get(boardKey)!.sort((a, b) => String(a.content_id).localeCompare(String(b.content_id)));
    const sourceIds = members.map((m) => String(m.content_id));
    const summary = stripLatex(members.map((m) => `- ${String(m.title ?? m.content_id)}`).join("\n"));
    const contentHash = await sha1hex(members.map((m) => `${m.content_id}:${m.title ?? ""}`).join("|"));
    const nodeId = await sha1hex(`board_summary|${boardKey}|${contentHash}`);
    const data = {
      node_id: nodeId,
      level: "board_summary",
      scope_ref: boardKey,
      summary_markdown: summary,
      source_event_ids: sourceIds,
      created_at: now.toISOString(),
      schema_version: SCHEMA_VERSION,
    };
    const res = await s.putEventAt(wikiKey(nodeId), agentEnvelope(WIKI_TYPE, WIKI_SCHEMA, data, now.toISOString()));
    if (res.status === "inserted") board_summaries++;
  }

  // big_wiki: 現存する board_summary ノードを 1 つの大 Wiki に束ねる（board の上位階層）。
  const boardNodes = (await s.listEvents(`truth/${WIKI_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.level === "board_summary")
    .sort((a, b) => String(a.node_id).localeCompare(String(b.node_id)));
  let big_wikis = 0;
  if (boardNodes.length) {
    const scopeRefs = boardNodes.map((b) => String(b.scope_ref));
    const boardIds = boardNodes.map((b) => String(b.node_id));
    const summary = stripLatex(scopeRefs.map((r) => `- ${r}`).join("\n"));
    const contentHash = await sha1hex(boardIds.join("|"));
    const nodeId = await sha1hex(`big_wiki|global|${contentHash}`);
    const data = {
      node_id: nodeId,
      level: "big_wiki",
      scope_ref: "global",
      summary_markdown: summary,
      source_event_ids: boardIds,
      created_at: now.toISOString(),
      schema_version: SCHEMA_VERSION,
    };
    const res = await s.putEventAt(wikiKey(nodeId), agentEnvelope(WIKI_TYPE, WIKI_SCHEMA, data, now.toISOString()));
    if (res.status === "inserted") big_wikis++;
  }

  // LLM 助言 enrich は既定 OFF でスキップ（実鍵投入 = §6 人間ゲート）。決定論経路は上で完了済。
  // ponytail: 実 LLM 呼出は未配線（§6 gated）。OFF 既定は常に 0 呼出＝スキップの観測点。
  // 実鍵投入で enrich を足す波までは llmMode に関わらず 0（決定論ノードのみを永続）。
  void llmMode;
  const llm_calls = 0;
  return { board_summaries, big_wikis, llm_calls };
}

// ── generateNewspaper（PPR-17）──────────────────────────────────────────────────
// 全 task_node を走査し、文明研究新聞を content_type=newspaper の content として append する
// （別スキーマ不要）。content_id = newspaper-<date>-<sha1(task_ids)> → 同一日・同一ノード集合で
// 同一新聞（冪等）。優先度降順ダイジェスト。task が 0 件なら新聞を作らず null。
export async function generateNewspaper(s: TruthStore, now: Date): Promise<string | null> {
  const tasks = (await s.listEvents(`truth/${TASK_TYPE}/`))
    .map(dataOf)
    .sort(
      (a, b) => Number(b.priority ?? 0) - Number(a.priority ?? 0) || String(a.task_id).localeCompare(String(b.task_id)),
    );
  if (!tasks.length) return null;
  const dateStr = now.toISOString().slice(0, 10);
  const digestHash = (await sha1hex(tasks.map((t) => String(t.task_id)).sort().join("|"))).slice(0, 12);
  const contentId = `newspaper-${dateStr}-${digestHash}`;
  const body = stripLatex(
    tasks.map((t) => `- [${Number(t.priority ?? 0)}] ${String(t.question ?? "")}`).join("\n"),
  );
  const data: Record<string, unknown> = {
    content_id: contentId,
    actor_id: SYSTEM_ACTOR,
    content_type: "newspaper",
    title: `Civilization Research Newspaper ${dateStr}`,
    body_markdown: body,
    created_at: now.toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  await s.putEventAt(contentKey(contentId), agentEnvelope(CONTENT_TYPE, CONTENT_SCHEMA, data, now.toISOString()));
  return contentId;
}

// ── runBatchOnce（手動トリガ本体・POST /research/agent/run と scheduled が共用）─────────
export interface BatchReport {
  task_nodes: number;
  board_summaries: number;
  big_wikis: number;
  newspaper_id: string | null;
  llm_mode: string;
  llm_calls: number;
}

export async function runBatchOnce(s: TruthStore, now: Date, opts?: { llmMode?: string }): Promise<BatchReport> {
  const llmMode = opts?.llmMode ?? "off";
  // env.ts の契約どおり: on は実 API キー(人間ゲート「実鍵投入」)が前提のため、
  // 実鍵配線が存在しない本波では off 以外を明示拒否する(LLM 既定 OFF・不変条項①)。
  if (llmMode !== "off") {
    throw new Error("RESEARCH_LLM_MODE=" + llmMode + " requires real-key wiring (human gate); only 'off' is supported");
  }
  const task_nodes = await generateTaskNodes(s, now);
  const wiki = await distillWiki(s, now, llmMode);
  const newspaper_id = await generateNewspaper(s, now);
  return {
    task_nodes,
    board_summaries: wiki.board_summaries,
    big_wikis: wiki.big_wikis,
    newspaper_id,
    llm_mode: llmMode,
    llm_calls: wiki.llm_calls,
  };
}

// ── taskTree 投影（PPR-17・都度再計算）──────────────────────────────────────────
// prefix scan → program_id で束ねた木（program_id 無しは "_root" グループ）。決定論: task_id 昇順。
export async function taskTree(s: TruthStore): Promise<{ items: Record<string, unknown>[]; groups: Record<string, string[]> }> {
  const items = (await s.listEvents(`truth/${TASK_TYPE}/`))
    .map(dataOf)
    .sort((a, b) => String(a.task_id).localeCompare(String(b.task_id)));
  const groups: Record<string, string[]> = {};
  for (const t of items) {
    const g = typeof t.program_id === "string" && t.program_id ? t.program_id : "_root";
    (groups[g] ??= []).push(String(t.task_id));
  }
  return { items, groups };
}

// ── routes ───────────────────────────────────────────────────────────────────────

// POST /research/tasks — 手動タスク作成（決定論 task_id・同一入力再 put=409・PPR-17）。
researchAgentBatchRoutes.post("/research/tasks", async (c) => {
  const actorId = c.get("actorId");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const kinds: SourceKind[] = ["limitation", "next_question", "data_gap", "failure_cluster", "complaint_cluster"];
  const kind = body.source_kind as SourceKind;
  const source_ref = typeof body.source_ref === "string" ? body.source_ref.trim() : "";
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!kinds.includes(kind) || !source_ref || !question) {
    return c.json({ error: "INVALID_TASK", details: ["source_kind(enum), source_ref, question required"] }, 400);
  }
  const difficulty = DIFFICULTY.includes(body.difficulty as Difficulty) ? (body.difficulty as Difficulty) : undefined;
  const priority = Number.isInteger(body.priority) ? (body.priority as number) : undefined;
  const program_id = typeof body.program_id === "string" && body.program_id ? body.program_id : undefined;

  const id = await taskId(kind, source_ref, question);
  const data: Record<string, unknown> = {
    task_id: id,
    question,
    source_kind: kind,
    source_ref,
    difficulty: difficulty ?? difficultyFor(question),
    priority: priority ?? priorityFor(kind, question),
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (program_id) data.program_id = program_id;
  const res = await store(c).putEventAt(taskKey(id), humanEnvelope(TASK_TYPE, TASK_SCHEMA, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_TASK", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_TASK", key: res.key }, 409);
  return c.json({ task_id: id, difficulty: data.difficulty, priority: data.priority }, 201);
});

// GET /research/tasks — タスク木の投影（program_id グルーピング・PPR-17）。
researchAgentBatchRoutes.get("/research/tasks", async (c) => {
  return c.json(await taskTree(store(c)));
});

// POST /research/agent/run — 日次蒸留 + タスク生成 + 新聞生成の単発手動トリガ（WIK-01/PPR-17）。
// Cron 定期配線は §6 人間ゲート（常駐トークン消費の開始）。ここは手動運転/TC 用。
researchAgentBatchRoutes.post("/research/agent/run", async (c) => {
  const llmMode = c.env.RESEARCH_LLM_MODE ?? "off";
  return c.json(await runBatchOnce(store(c), new Date(), { llmMode }));
});

// GET /research/newspaper — 最新の文明研究新聞を投影（created_at 降順・PPR-17）。
researchAgentBatchRoutes.get("/research/newspaper", async (c) => {
  const papers = (await store(c).listEvents(`truth/${CONTENT_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.content_type === "newspaper")
    .sort(
      (a, b) =>
        String(b.created_at).localeCompare(String(a.created_at)) ||
        String(a.content_id).localeCompare(String(b.content_id)),
    );
  return c.json({ newspaper: papers[0] ?? null });
});

// GET /research/wiki/:node_id — 蒸留 Wiki ノードの取得（WIK-01）。
researchAgentBatchRoutes.get("/research/wiki/:node_id", async (c) => {
  const ev = await store(c).readEvent(wikiKey(c.req.param("node_id")));
  if (!ev) return c.json({ error: "WIKI_NODE_NOT_FOUND" }, 404);
  return c.json(dataOf(ev));
});

// ── Cloudflare Workers scheduled ハンドラ実体（日次・NEWSPAPER_CRON_UTC で index.ts が dispatch）──
// 実 trigger 有効化（wrangler.toml [triggers] crons）は §6 人間ゲート（常駐トークン消費の開始）。
export interface ScheduledEventLike {
  scheduledTime?: number;
  cron?: string;
}
export async function handleResearchScheduled(event: ScheduledEventLike, env: Bindings): Promise<void> {
  const now = new Date(typeof event?.scheduledTime === "number" ? event.scheduledTime : Date.now());
  const llmMode = env.RESEARCH_LLM_MODE ?? "off";
  await runBatchOnce(new TruthStore(env.TRUTH), now, { llmMode });
}
