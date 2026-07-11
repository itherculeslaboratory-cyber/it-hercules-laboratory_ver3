// C5 K5 共通 CMS 基盤（design-k5 §2.1/§2.3 / V3-WIK-16/13/14/17・PPR-03/30）。論文/記事/
// ブログ/チャットログ/新聞を単一イベント ihl.research.content.v1 + content_type enum で兼用
// （エンティティ乱立を避ける・WIK-16）。「投稿=即検索可能」「R2 索引自動更新」は維持型二次
// インデックスを持たず prefix scan 投影で満たす（append それ自体が索引更新・不変条項①・WIK-13）。
// 書込 actor_id はセッション principal 強制（V3-AUT-17）。全 route は index.ts §1.5 gate 経由
// PROTECTED（deny-by-default: PUBLIC_ROUTES に載せない）。投影は都度再計算（常駐 DB 禁止）で
// proposal-routes.ts の reduceProposal パターンを流用。envelope/store/dataOf は inline。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { AI_TAGS_MAX, RAG_PRIORITY } from "./research-constants";

export const researchContentRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const CONTENT_TYPE = "ihl.research.content.v1";
const CONTENT_SCHEMA = "schemas/events/content.schema.json";
// content タグは新スキーマを作らず frozen tag-event を再利用（target_type="cross"・tag_type
// で system/ai/user 3 層を区別）。K5 名前空間の type prefix に隔離（obs タグと非干渉）。
const TAG_TYPE = "ihl.research.tag_event.v1";
const TAG_SCHEMA = "schemas/frozen/tag-event.schema.json";
const SCHEMA_VERSION = "1";
const TAG_LAYERS = ["system", "ai", "user"] as const;
type TagLayer = (typeof TAG_LAYERS)[number];

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}
function contentKey(contentId: string): string {
  return `truth/${CONTENT_TYPE}/${contentId}.json`;
}
function envelope(type: string, schema: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id: ulid(),
    source: "apps/api",
    type,
    time: new Date().toISOString(),
    dataschema: schema,
    // V3-AUT-17: session principal を provenance に刻印（POST /events と同一）。
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}

// createContent が data へ透過コピーする任意フィールド（undefined は落とす — additionalProperties
// false の inner schema を通すため未定義キーを付けない）。paper 専用フィールドも含む。
const OPTIONAL_KEYS = [
  "body_markdown", "cited_paper_ids", "cited_session_ids", "project_id", "individual_id",
  "skin_id", "client_content_digest", "observed_at", "system_tags", "ai_tags", "user_tags",
  "sections", "completeness_pct", "conditions", "claims", "measurements",
] as const;

// ── content 3 層タグ投影（都度再計算・純関数）──────────────────────────────────
// frozen tag-event を tag_type(system/ai/user) で層分けし、層ごとに tag の最新 action を
// 畳む。AI が user を上書きしないのは層が別バケットで独立に畳まれるため（WIK-14）。
export interface ContentTags { system_tags: string[]; ai_tags: string[]; user_tags: string[] }

export async function aggregateContentTags(s: TruthStore, contentId: string): Promise<ContentTags> {
  const rows = (await s.listEvents(`truth/${TAG_TYPE}/cross-${contentId}-`))
    .map(dataOf)
    .filter((d) => d.target_type === "cross" && d.target_id === contentId)
    .sort((a, b) =>
      String(a.created_at).localeCompare(String(b.created_at)) ||
      String(a.tag_event_id).localeCompare(String(b.tag_event_id)));
  const state: Record<TagLayer, Map<string, boolean>> = { system: new Map(), ai: new Map(), user: new Map() };
  for (const d of rows) {
    const layer = TAG_LAYERS.includes(d.tag_type as TagLayer) ? (d.tag_type as TagLayer) : null;
    const tag = String(d.tag ?? "");
    if (!layer || !tag) continue;
    state[layer].set(tag, d.action !== "remove");
  }
  const on = (m: Map<string, boolean>) => [...m.entries()].filter(([, v]) => v).map(([t]) => t).sort();
  return { system_tags: on(state.system), ai_tags: on(state.ai), user_tags: on(state.user) };
}

// ── suggestTags（決定論・非永続・WIK-14）────────────────────────────────────────
// 本文トークン頻度で ai_tags 最大 AI_TAGS_MAX を提案するのみ（永続化しない）。ユーザーが
// addTag で確認 POST した時にのみ tag_event を append する ＝ AI が人間タグを上書きしない。
export function suggestTags(content: Record<string, unknown>): string[] {
  const text = `${String(content.title ?? "")} ${String(content.body_markdown ?? "")}`.toLowerCase();
  const freq = new Map<string, number>();
  for (const tok of text.split(/[^a-z0-9]+/).filter((t) => t.length >= 3)) {
    freq.set(tok, (freq.get(tok) ?? 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, AI_TAGS_MAX)
    .map(([t]) => t);
}

// ── unifiedSearch（4 本柱合成投影・WIK-13/14）──────────────────────────────────
// fulltext(title→summary / body→payload)・tag(system/ai/user 層)・user(actor_id)・node
// (content_id/type) を prefix scan で合成。RAG_PRIORITY 順で並べ、スコア同点は content_id 昇順
// （決定論）。embedding は query_vector 未指定＝OFF 既定（不変条項①）。
export interface SearchQuery {
  text?: string; tags?: string[]; user?: string; node?: string; type?: string;
  query_vector?: number[];
}
export interface SearchHit {
  content_id: string; content_type: string; title: string; actor_id: string;
  matched: string[]; rank_source: string;
}

export async function unifiedSearch(s: TruthStore, q: SearchQuery): Promise<SearchHit[]> {
  const contents = (await s.listEvents(`truth/${CONTENT_TYPE}/`)).map(dataOf);
  const scored: Array<SearchHit & { rankIdx: number }> = [];
  for (const c of contents) {
    const contentId = String(c.content_id);
    if (q.type && c.content_type !== q.type) continue;
    const matched = new Set<string>();
    if (q.text) {
      if (String(c.title ?? "").includes(q.text)) matched.add("summary");
      if (typeof c.body_markdown === "string" && c.body_markdown.includes(q.text)) matched.add("payload");
    }
    if (q.tags && q.tags.length) {
      // ponytail: per-content tag re-scan. Fine for MVP volumes; a single-pass
      // tag map is the upgrade path if search fan-out ever dominates.
      const t = await aggregateContentTags(s, contentId);
      if (t.system_tags.some((x) => q.tags!.includes(x))) matched.add("system");
      if (t.ai_tags.some((x) => q.tags!.includes(x))) matched.add("ai");
      if (t.user_tags.some((x) => q.tags!.includes(x))) matched.add("user");
    }
    // user(author) / node pillars: hit の入口だが RAG チャネルは持たない（フィルタ扱い）。
    let pillarHit = false;
    if (q.user && c.actor_id === q.user) pillarHit = true;
    if (q.node && (contentId === q.node || c.content_type === q.node)) pillarHit = true;
    if (matched.size === 0 && !pillarHit) continue;
    let rankIdx: number = RAG_PRIORITY.length; // as const → .length は 6 リテラル型。number へ広げる
    let rankSource = "";
    for (let i = 0; i < RAG_PRIORITY.length; i++) {
      if (matched.has(RAG_PRIORITY[i])) { rankIdx = i; rankSource = RAG_PRIORITY[i]; break; }
    }
    scored.push({
      content_id: contentId, content_type: String(c.content_type), title: String(c.title ?? ""),
      actor_id: String(c.actor_id ?? ""),
      matched: RAG_PRIORITY.filter((r) => matched.has(r)),
      rank_source: rankSource, rankIdx,
    });
  }
  scored.sort((a, b) => a.rankIdx - b.rankIdx || a.content_id.localeCompare(b.content_id));
  return scored.map(({ rankIdx: _drop, ...hit }) => hit);
}

// ── chatIndex（WIK-17）─────────────────────────────────────────────────────────
// content_type=chat_log を prefix scan → 時系列（created_at 降順・同点 content_id）索引投影。
export interface ChatIndexRow { content_id: string; title: string; body_markdown?: string; created_at: string }

export async function chatIndex(s: TruthStore): Promise<ChatIndexRow[]> {
  return (await s.listEvents(`truth/${CONTENT_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.content_type === "chat_log")
    .map((d) => ({
      content_id: String(d.content_id),
      title: String(d.title ?? ""),
      body_markdown: typeof d.body_markdown === "string" ? d.body_markdown : undefined,
      created_at: String(d.created_at ?? ""),
    }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.content_id.localeCompare(b.content_id));
}

// ── routes ─────────────────────────────────────────────────────────────────────

// POST /research/content — content 作成（INSERT ONLY・同一 content_id 再 put=409・WIK-16）。
// paper は content.schema.json の if/then で sections/completeness_pct 必須（PPR-03）。
researchContentRoutes.post("/research/content", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");
  const contentId = typeof body.content_id === "string" && body.content_id ? body.content_id : ulid();
  const data: Record<string, unknown> = {
    content_id: contentId,
    actor_id: actorId, // V3-AUT-17 強制刻印（クライアント指定は無視）
    content_type: body.content_type,
    title: body.title,
    created_at: typeof body.created_at === "string" ? body.created_at : new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  for (const k of OPTIONAL_KEYS) if (body[k] !== undefined) data[k] = body[k];
  const res = await store(c).putEventAt(contentKey(contentId), envelope(CONTENT_TYPE, CONTENT_SCHEMA, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_CONTENT", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_CONTENT", key: res.key }, 409);
  return c.json({ content_id: contentId, key: res.key }, 201);
});

// GET /research/content — 一覧投影（?type= フィルタ・content_id 昇順決定論・WIK-16/13）。
researchContentRoutes.get("/research/content", async (c) => {
  const type = c.req.query("type");
  const items = (await store(c).listEvents(`truth/${CONTENT_TYPE}/`))
    .map(dataOf)
    .filter((d) => !type || d.content_type === type)
    .sort((a, b) => String(a.content_id).localeCompare(String(b.content_id)));
  return c.json({ items });
});

// GET /research/content/:id — 詳細 + 3 層タグ集約投影（正本は tag-event・WIK-16/14）。
researchContentRoutes.get("/research/content/:id", async (c) => {
  const id = c.req.param("id");
  const ev = await store(c).readEvent(contentKey(id));
  if (!ev) return c.json({ error: "CONTENT_NOT_FOUND" }, 404);
  const tags = await aggregateContentTags(store(c), id);
  return c.json({ ...dataOf(ev), tags });
});

// POST /research/content/:id/tags — 確認 POST でのみ tag_event を append（WIK-14）。
// 人手経路は tag_type ∈ {ai,user} のみ。system 層は「自動編集不可」(V3-WIK-14) で
// agent/batch 経路（research-agent-batch）だけが発行する。人手 system 投稿を許すと RAG_PRIORITY
// の最上位(system>ai>user)を自作コンテンツに刺して検索順位を操作できるため 400 で拒否（批評家 minor）。
researchContentRoutes.post("/research/content/:id/tags", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const tagType = body.tag_type;
  if (tagType !== "ai" && tagType !== "user") {
    return c.json({ error: "INVALID_TAG", details: ["tag_type must be ai|user (system layer is system-generated only)"] }, 400);
  }
  const data: Record<string, unknown> = {
    tag_event_id: ulid(),
    target_type: "cross",
    target_id: id,
    tag: body.tag,
    tag_type: tagType,
    action: typeof body.action === "string" ? body.action : "add",
    source_type: typeof body.source_type === "string" ? body.source_type : String(tagType),
    created_at: new Date().toISOString(),
    schema_version: 1,
  };
  const key = `truth/${TAG_TYPE}/cross-${id}-${ulid()}.json`;
  const res = await store(c).putEventAt(key, envelope(TAG_TYPE, TAG_SCHEMA, c.get("actorId"), data));
  if (res.status === "invalid") return c.json({ error: "INVALID_TAG", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_TAG", key: res.key }, 409);
  return c.json({ tag_event_id: data.tag_event_id, layer: tagType }, 201);
});

// POST /research/content/:id/tags/suggest — 決定論 ai_tags 提案（≤10・非永続・WIK-14）。
researchContentRoutes.post("/research/content/:id/tags/suggest", async (c) => {
  const id = c.req.param("id");
  const ev = await store(c).readEvent(contentKey(id));
  if (!ev) return c.json({ error: "CONTENT_NOT_FOUND" }, 404);
  return c.json({ content_id: id, ai_tags: suggestTags(dataOf(ev)), persisted: false });
});

// POST /research/search — 4 本柱統合検索投影（RAG_PRIORITY 順・WIK-13/14）。
researchContentRoutes.post("/research/search", async (c) => {
  const q = (await c.req.json().catch(() => ({}))) as SearchQuery;
  return c.json({ results: await unifiedSearch(store(c), q) });
});

// POST /research/shared — PWA share_target 受信（WIK-17）。共有物を content_type=chat_log で
// append。body は JSON か form（title/text/url）。LaTeX 禁止（\ と $ を除去）。
researchContentRoutes.post("/research/shared", async (c) => {
  const ct = c.req.header("content-type") ?? "";
  const body: Record<string, unknown> = ct.includes("application/json")
    ? ((await c.req.json().catch(() => ({}))) as Record<string, unknown>)
    : Object.fromEntries((await c.req.formData().catch(() => new FormData())).entries());
  const actorId = c.get("actorId");
  const contentId = ulid();
  // LATEX_FORBIDDEN は非 global（検証用単一 match）。ここは全 \ と $ を除去するので
  // global パターンで sanitize する（共有元テキストは任意文字を含みうる）。
  const strip = (v: unknown) => String(v ?? "").replace(/[\\$]/g, "");
  const title = strip(body.title || body.url || "shared") || "shared";
  const parts = [body.text, body.url].map(strip).filter(Boolean);
  const data: Record<string, unknown> = {
    content_id: contentId,
    actor_id: actorId,
    content_type: "chat_log",
    title,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (parts.length) data.body_markdown = parts.join("\n");
  const res = await store(c).putEventAt(contentKey(contentId), envelope(CONTENT_TYPE, CONTENT_SCHEMA, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_CONTENT", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_CONTENT", key: res.key }, 409);
  return c.json({ content_id: contentId }, 201);
});

// GET /research/chat-index — chat_log 時系列索引投影（WIK-17）。
researchContentRoutes.get("/research/chat-index", async (c) => {
  return c.json({ items: await chatIndex(store(c)) });
});
