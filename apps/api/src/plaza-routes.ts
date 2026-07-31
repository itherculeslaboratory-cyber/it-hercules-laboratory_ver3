// 知の広場書込 route + 決定論投影(design-c5.md §K6 §2.1 slot033-036 / §2.3)。post/stance/
// fork/signal/summary を Truth へ append(多セグメントキーは putEventAt=put-if-absent・
// INSERT ONLY)。スレ表示・consensus・fork ランク・ランキング・要約は全て listEvents の
// prefix scan で都度再計算(常駐 DB 禁止・不変条項①)。LLM 呼び出しゼロ(要約本文/embedding
// は空スロット=手動/後日バッチが append)。全 route PROTECTED(index.ts の auth middleware が
// gate・actorId を set)。書込 data.actor_id はセッション principal で強制刻印(V3-AUT-17)。
// 定数は plaza-constants.ts 単一正本(散在ハードコード禁止)。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { projectPreferences } from "./settings-routes";
import {
  BOARD_KINDS,
  PAPER_CASE_KINDS,
  PAPER_CASE_TAG_PREFIX,
  FORK_RANKS,
  CONSENSUS_MIN_VOTES,
  CONSENSUS_AGREE_RATIO,
  DIVISIVE_MIN_SIDE_RATIO,
  SUMMARY_BLOCK_SIZE,
  RANKING_WEIGHTS,
  PLZ_VERIFIED_CITE_MIN,
  PLZ_VERIFIED_RETRY_MIN,
  PLZ_REFUTED_RETRY_MIN,
  PLZ_UNRESOLVED_STANCE_MIN,
  BBS14_BLOCKED_TERMS,
} from "./plaza-constants";
// BBS-14: 改善要求の投票基盤は既存プラチナ投票(KRM-25・GOV-07/MKT-35 と同一の積み投票
// 通貨方式)を再利用する。新規投票機構は作らない(round-16 裁定準拠)。
import { projectPlatinumVoteTally, OFFICIAL_THRESHOLD_KEY, OFFICIAL_THRESHOLD_DEFAULT } from "./social-routes";
import { resolvePolicyInt } from "./policy";
// BBS-25(design35 §A-5): 統一ノードビューの実体は node-dispatch-routes.ts(bridge2 新設・
// content/ppr-cycle-node/plaza-post の3型を1本のディスパッチャで振り分け)。plaza側の
// /plaza/node/:post_id はこのディスパッチャを呼ぶだけにし、post 全走査ロジックを2重に
// 持たない(reuse-first)。node-dispatch-routes.ts 自体はこの艦のglob外(bridge2所有)だが、
// 既にexportされている関数を読み取りimportするだけなので越境ではない。
import { dispatchNode } from "./node-dispatch-routes";

const POST_TYPE = "ihl.plaza.post.v1";
const POST_SCHEMA = "schemas/events/plaza-post.schema.json";
const STANCE_TYPE = "ihl.plaza.stance.v1";
const STANCE_SCHEMA = "schemas/events/plaza-stance.schema.json";
const FORK_TYPE = "ihl.plaza.fork.v1";
const FORK_SCHEMA = "schemas/events/plaza-fork.schema.json";
const SIGNAL_TYPE = "ihl.plaza.signal.v1";
const SIGNAL_SCHEMA = "schemas/events/plaza-signal.schema.json";
const SUMMARY_TYPE = "ihl.plaza.summary.v1";
const SUMMARY_SCHEMA = "schemas/events/plaza-summary.schema.json";
const RESOLUTION_TYPE = "ihl.plaza.resolution.v1";
const RESOLUTION_SCHEMA = "schemas/events/plaza-resolution.schema.json";
// V3-PPR-08(bridgeplan J1-3・design35): 論文↔板の双方向リンクを独立イベント列で持つ。
// content.schema.json は1文字も触らない(citation-link.schema.json は bridge2 が新設済み・
// この艦は既存スキーマを読み取り import するだけ=schemas/events/* を編集していない)。
const CITATION_LINK_TYPE = "ihl.citation.link.v1";
const CITATION_LINK_SCHEMA = "schemas/events/citation-link.schema.json";
// gov.vote は K6-gov 側が書き込む。投影は読み取りだけ参照(fork ランク昇降/ランキング)。
const VOTE_TYPE = "ihl.gov.vote.v1";
const SCHEMA_VERSION = "1";
// CL-08 embedding-manifest(既存基盤・384 次元 L2 正規化)。要約 4 層の第 1/2 層は
// この manifest を参照する空スロット(ベクトル本体は後日バッチが埋める・LLM 直呼びなし)。
const EMBEDDING_REF = { manifest: "schemas/frozen/embedding-manifest.schema.json", dim: 384 } as const;

export const plazaRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function envelope(type: string, schema: string, id: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type,
    time: new Date().toISOString(),
    dataschema: schema,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}

// ── CiteRef 補助(BBS-20)────────────────────────────────────────────────
export type CiteRef = { type: string; id: string; label?: string; post_id?: string };

// [ihl:cite type=X id=Y] トークンを抽出。cite_refs[] が正本・トークンは従属。
export function parseCiteTokens(body: string): CiteRef[] {
  const out: CiteRef[] = [];
  const re = /\[ihl:cite\s+type=([a-z]+)\s+id=([^\]\s]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.push({ type: m[1], id: m[2] });
  return out;
}

// 明示 cite_refs(正本)を優先し、本文トークン由来を「未収録の (type,id) だけ」補う。
export function mergeCiteRefs(explicit: unknown, tokens: CiteRef[]): CiteRef[] {
  const refs: CiteRef[] = Array.isArray(explicit)
    ? (explicit.filter((r) => r && typeof r === "object" && typeof (r as CiteRef).type === "string" && typeof (r as CiteRef).id === "string") as CiteRef[])
    : [];
  const seen = new Set(refs.map((r) => `${r.type}:${r.id}`));
  for (const t of tokens) {
    const k = `${t.type}:${t.id}`;
    if (!seen.has(k)) {
      seen.add(k);
      refs.push(t);
    }
  }
  return refs;
}

// type→安定 URL(permalink・BBS-20)。全 CiteRef type を網羅し空文字を返さない。
export function citeUrl(ref: CiteRef): string {
  const id = encodeURIComponent(ref.id);
  switch (ref.type) {
    case "observation": return `/observations/${id}`;
    case "individual": return `/individuals/${id}`;
    case "paper": return `/knowledge/paper/${id}`;
    case "thread": return `/knowledge/board/t/${id}`;
    case "post": return `/knowledge/board/p/${id}`;
    case "user": return `/u/${id}`;
    case "tag": return `/knowledge/board/tag/${id}`;
    case "listing": return `/market/listings/${id}`;
    case "precedent": return `/gov/precedents/${id}`;
    case "fork": return `/knowledge/forks/${id}`;
    // PPR-23: 論文引用管理の4タイプ(observation/paper/url/book)の残り2つ。url は
    // ref.id 自体が外部 URL(そのまま返す=直リンク)。book は内部書誌 permalink。
    case "url": return ref.id;
    case "book": return `/knowledge/book/${id}`;
    default: return `/knowledge/cite/${encodeURIComponent(ref.type)}/${id}`;
  }
}

// content_hash 用(GOV-23 改変検知)。Web Crypto subtle・SHA-256 hex。
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// cite target の実在解決。scan 可能な post/fork のみ検証(欠落→tombstone)。外部型
// (observation/paper/user/tag/listing/precedent/individual/thread)はここでは検証せず存置。
// exported: V3-WIK-07(月次Lint)が壊れたリンク検出に同じ実在チェックを再利用する
// (knowledge-lint.ts・重複実装を避ける)。
export async function citeTargetExists(s: TruthStore, ref: CiteRef): Promise<boolean> {
  if (ref.type === "post") {
    const posts = await s.listEvents(`truth/${POST_TYPE}/`);
    return posts.some((e) => dataOf(e).post_id === ref.id);
  }
  if (ref.type === "fork") {
    const forks = await s.listEvents(`truth/${FORK_TYPE}/`);
    return forks.some((e) => dataOf(e).fork_id === ref.id);
  }
  return true;
}

// BBS-14: 改善要求(board_kind=improvement)の AI 安全チェック。LLM 既定 OFF(不変条項①)の
// 決定論フォールバック=固定ブロックリストの部分一致(大小文字無視)。真の攻撃的内容分類は
// ai-kernel.ts の classify task に実鍵が入ってから差し替える(§6 人間ゲート・upgrade path)。
export function isOffensiveContent(text: string): boolean {
  const lower = text.toLowerCase();
  return BBS14_BLOCKED_TERMS.some((term) => lower.includes(term.toLowerCase()));
}

// ── 投稿(BBS-01/03/05/20/36)──────────────────────────────────────────
// POST /plaza/posts — 投稿を append。多セグメントキー
// truth/ihl.plaza.post.v1/<channel>/<thread_id>/<post_id>.json に putEventAt。
// topic/board_kind/body の必須・enum は envelope schema 検証が gate(欠落→400)。
// cite_refs[] を正本に、本文の [ihl:cite] トークンを統合(BBS-20)。actor_id 強制刻印。
// board_kind=improvement(BBS-14)は投稿前に isOffensiveContent で AI 安全チェック(拒否 400)。
plazaRoutes.post("/plaza/posts", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const channel = str(body?.channel);
  if (!channel) return c.json({ error: "INVALID_POST", details: ["channel required"] }, 400);
  if (body?.board_kind === "improvement" && isOffensiveContent(str(body?.body))) {
    return c.json({ error: "AI_SAFETY_REJECTED", details: ["offensive content blocked"] }, 400);
  }

  const actorId = c.get("actorId");
  const postId = str(body?.post_id) || ulid();
  const threadId = str(body?.thread_id) || postId;

  const data: Record<string, unknown> = {
    post_id: postId,
    actor_id: actorId,
    channel,
    thread_id: threadId,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  // topic/board_kind/body は present なら通す(欠落は required 違反で 400・enum も schema gate)。
  if (body?.topic !== undefined) data.topic = body.topic;
  if (body?.board_kind !== undefined) data.board_kind = body.board_kind;
  if (body?.body !== undefined) data.body = body.body;
  if (typeof body?.reply_to === "string") data.reply_to = body.reply_to;
  if (typeof body?.correction_of === "string") data.correction_of = body.correction_of;
  if (typeof body?.context_individual_id === "string") data.context_individual_id = body.context_individual_id;
  // HDR-1(A1#4 slice2b是正・batch3 advisory3): market-routes.ts:152 と同様の truthy
  // ガード。schema は species_id を minLength:1 とするため空文字を通すと 400 になる
  // (context_individual_id 等の他 passthrough と挙動を揃える)。
  if (typeof body?.species_id === "string" && body.species_id) data.species_id = body.species_id;
  if (Array.isArray(body?.mentions)) data.mentions = body.mentions;
  const tags: string[] = Array.isArray(body?.tags) ? [...body.tags] : [];
  // BBS-02: 論文板ケース分け(独立Research Board板は設けない)。plaza-post.schema.json は
  // additionalProperties:false の凍結スキーマ(本ラウンドの glob 外)のため新規 top-level
  // フィールドは追加できない。BBS-28(engagement:<kind>)と同型の tags[] prefix 方式で表現する。
  if (typeof body?.paper_case === "string") {
    if (!(PAPER_CASE_KINDS as readonly string[]).includes(body.paper_case)) {
      return c.json({ error: "INVALID_POST", details: [`paper_case must be one of ${PAPER_CASE_KINDS.join(",")}`] }, 400);
    }
    tags.push(`${PAPER_CASE_TAG_PREFIX}${body.paper_case}`);
  }
  if (tags.length) data.tags = tags;
  const refs = mergeCiteRefs(body?.cite_refs, parseCiteTokens(str(body?.body)));
  if (refs.length) data.cite_refs = refs;
  // I18-06: UGC 原文の作者言語タグを actor の locale から刻印(翻訳はしない・market-routes.ts
  // と同型・未設定は projectPreferences が DEFAULT_LOCALE=ja)。
  data.lang = (await projectPreferences(store(c), actorId)).locale;

  const key = `truth/${POST_TYPE}/${channel}/${threadId}/${postId}.json`;
  const s = store(c);
  const res = await s.putEventAt(key, envelope(POST_TYPE, POST_SCHEMA, postId, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_POST", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_POST", key: res.key }, 409);
  // V3-PPR-08(板側): 論文を引用する投稿は同時に citation-link イベントを1本 append する
  // (content.schema.json は触らず独立イベント列に記録・bridgeplan J1-3どおり)。best-effort
  // (citation-link の append 失敗は投稿自体の成功を道連れにしない=投稿本体が正)。
  for (const ref of refs) {
    if (ref.type !== "paper") continue;
    await appendCitationLink(s, ref.id, actorId, { type: "thread", id: threadId }, "discussed_in").catch(() => {});
  }
  return c.json({ post_id: postId, thread_id: threadId }, 201);
});

// appendCitationLink — V3-PPR-08 citation-link 1行を append(INSERT ONLY・削除不可)。
// キー truth/ihl.citation.link.v1/<content_id>/<link_id>.json(bridgeplan J1-3 の設計どおり)。
export async function appendCitationLink(
  s: TruthStore,
  contentId: string,
  actorId: string,
  targetRef: CiteRef,
  linkKind?: "cites" | "discussed_in" | "derived_from" | "responds_to",
): Promise<{ link_id: string } | null> {
  const linkId = ulid();
  const data: Record<string, unknown> = {
    link_id: linkId,
    content_id: contentId,
    target_ref: targetRef,
    actor_id: actorId,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (linkKind) data.link_kind = linkKind;
  const key = `truth/${CITATION_LINK_TYPE}/${contentId}/${linkId}.json`;
  const res = await s.putEventAt(key, envelope(CITATION_LINK_TYPE, CITATION_LINK_SCHEMA, linkId, actorId, data));
  return res.status === "inserted" ? { link_id: linkId } : null;
}

// projectThread — thread の materialized view(ULID 昇順・correction_of は原投稿に
// 追記畳込で両方保持・cite 欠落は tombstone に積むが cite_ref 自体は消さない・BBS-05)。
// route は channel を持たないので post 全走査を thread_id で絞る(都度再計算)。
export async function projectThread(s: TruthStore, threadId: string) {
  const posts = (await s.listEvents(`truth/${POST_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.thread_id === threadId)
    .sort((a, b) => (str(a.post_id) < str(b.post_id) ? -1 : 1));
  if (!posts.length) return null;

  const byId = new Map(posts.map((p) => [str(p.post_id), p]));
  for (const p of posts) {
    const target = p.correction_of ? byId.get(str(p.correction_of)) : undefined;
    if (target) ((target.corrections ??= []) as string[]).push(str(p.post_id));
  }
  const tombstones: { ref: CiteRef; reason: string }[] = [];
  for (const p of posts) {
    for (const ref of (p.cite_refs as CiteRef[] | undefined) ?? []) {
      if (!(await citeTargetExists(s, ref))) tombstones.push({ ref, reason: "target_missing" });
    }
  }
  return { thread_id: threadId, channel: str(posts[0].channel), topic: str(posts[0].topic), posts, tombstones };
}

// GET /plaza/threads/:thread_id — スレ投影(404 or view)。resolution(OQ-PLZ-03)・
// promotion(OQ-PLZ-01)を同梱(バインド用データ・レンダラ側の追加実装は L6 レーン)。
plazaRoutes.get("/plaza/threads/:thread_id", async (c) => {
  const threadId = c.req.param("thread_id");
  const s = store(c);
  const view = await projectThread(s, threadId);
  if (!view) return c.json({ error: "NOT_FOUND" }, 404);
  const [resolution, promotion] = await Promise.all([
    projectResolution(s, threadId),
    projectPromotionStatus(s, threadId),
  ]);
  return c.json({ ...view, resolution, promotion });
});

// GET /plaza/threads/:thread_id/paper-citations — スレが引用する論文一覧(V3-PPR-08「掲示板↔
// 論文」双方向リンクのうち板→論文方向の投影)。[2026-08-01 w-plaza2追記] bridgeplan J1-3の
// 指示どおり citation-link イベント経由に寄せた: (1) 引き続き post.cite_refs(type=paper)を
// 集約(後方互換・既存投稿はcitation-link行を持たないため) (2) 新たに citation-link を
// target_ref={type:"thread",id:threadId} で prefix scan し content_id を合算する
// (POST /plaza/posts が論文引用時に自動 append する行・上記 appendCitationLink 参照)。
// 論文→板方向(査読コメントR2 append-onlyレイヤーを含む完全な双方向リンク)は
// content.schema.json 側の変更を要し本艦glob外のため対象外(bridgeplanどおり査読コメントは
// 新規スキーマを作らずplaza-postをそのまま使う=/board/paperチャンネルへの投稿がそれ)。
export async function projectPaperCitationsForThread(
  s: TruthStore,
  threadId: string,
): Promise<{ thread_id: string; paper_ids: string[]; via_citation_link: string[] } | null> {
  const view = await projectThread(s, threadId);
  if (!view) return null;
  const paperIds = new Set<string>();
  for (const p of view.posts) {
    for (const ref of (p.cite_refs as CiteRef[] | undefined) ?? []) {
      if (ref.type === "paper") paperIds.add(ref.id);
    }
  }
  // citation-link は content_id(論文側)でキー付けされている(truth/ihl.citation.link.v1/
  // <content_id>/<link_id>.json)ため、板→論文方向の逆引きは全件走査になる(「index がある
  // かのように書くな」=node-dispatch-routes.ts と同じ正直な注記)。
  const links = (await s.listEvents(`truth/${CITATION_LINK_TYPE}/`)).map(dataOf);
  const viaCitationLink = new Set<string>();
  for (const l of links) {
    const target = l.target_ref as CiteRef | undefined;
    if (target?.type === "thread" && target.id === threadId) viaCitationLink.add(str(l.content_id));
  }
  for (const id of viaCitationLink) paperIds.add(id);
  return { thread_id: threadId, paper_ids: [...paperIds], via_citation_link: [...viaCitationLink] };
}

plazaRoutes.get("/plaza/threads/:thread_id/paper-citations", async (c) => {
  const view = await projectPaperCitationsForThread(store(c), c.req.param("thread_id"));
  if (!view) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json(view);
});

// projectChannelThreads — channel 内スレ一覧(thread ごと集約 + board_kind グルーピング・
// BBS-03 の3板)。channel prefix scan。speciesFilter(HDR-1・A1#4・任意)はスレの
// root 投稿(thread_id===post_id)の species_id を代表値とみなし完全一致(大小無視)
// で絞る(plaza-post.species_id/SW-1・ヘッダー観測対象narrowingの基盤)。省略時は
// 既存呼び出し(projectImprovementQueue 等)と挙動不変。
// BBS-02: tags[] から "paper_case:<kind>" prefix を取り出す(engagement: prefix と同型)。
export function paperCaseOf(tags: unknown): string | undefined {
  if (!Array.isArray(tags)) return undefined;
  const hit = tags.find((t) => typeof t === "string" && t.startsWith(PAPER_CASE_TAG_PREFIX));
  return typeof hit === "string" ? hit.slice(PAPER_CASE_TAG_PREFIX.length) : undefined;
}

export async function projectChannelThreads(s: TruthStore, channel: string, speciesFilter?: string, caseFilter?: string) {
  const posts = (await s.listEvents(`truth/${POST_TYPE}/${channel}/`)).map(dataOf);
  const threads = new Map<
    string,
    { thread_id: string; topic: string; board_kind: string; post_count: number; latest_at: string; species_id?: string; paper_case?: string }
  >();
  for (const p of posts) {
    const tid = str(p.thread_id);
    const t = threads.get(tid) ?? { thread_id: tid, topic: str(p.topic), board_kind: str(p.board_kind), post_count: 0, latest_at: "" };
    t.post_count += 1;
    if (str(p.created_at) > t.latest_at) t.latest_at = str(p.created_at);
    // root(thread_id===post_id)の topic/board_kind/species_id/paper_case を代表値に採る。
    if (str(p.post_id) === tid) {
      t.topic = str(p.topic);
      t.board_kind = str(p.board_kind);
      if (typeof p.species_id === "string") t.species_id = p.species_id;
      const pc = paperCaseOf(p.tags);
      if (pc) t.paper_case = pc;
    }
    threads.set(tid, t);
  }
  let list = [...threads.values()].sort((a, b) => (a.thread_id < b.thread_id ? -1 : 1));
  const speciesQ = (speciesFilter ?? "").trim().toLowerCase();
  if (speciesQ) list = list.filter((t) => (t.species_id ?? "").toLowerCase() === speciesQ);
  // BBS-02: 論文板 case チップフィルタ(board_kind=paper のスレのみ paper_case を持つ)。
  const caseQ = (caseFilter ?? "").trim().toLowerCase();
  if (caseQ) list = list.filter((t) => (t.paper_case ?? "").toLowerCase() === caseQ);
  const boards: Record<string, typeof list> = {};
  for (const k of BOARD_KINDS) boards[k] = [];
  for (const t of list) (boards[t.board_kind] ??= []).push(t);
  return { channel, threads: list, boards };
}

// GET /plaza/channels/:channel/threads — channel 別スレ一覧 + 板別集計。?species= は
// HDR-1(A1#4)ヘッダー観測対象narrowing。?case= は BBS-02 論文板 paper_case チップフィルタ
// (board_kind=paper 以外のスレには paper_case が無いため無視される)。
plazaRoutes.get("/plaza/channels/:channel/threads", async (c) => {
  return c.json(
    await projectChannelThreads(store(c), c.req.param("channel"), c.req.query("species"), c.req.query("case")),
  );
});

// ── 検索(T-69 KNW wave1 Stage1「これ?」重複防止検索)────────────────────────
// projectChannelThreads と同じ post 全走査(常駐 index 無し・都度再計算=不変
// 条項①)を channel 未指定でも使えるよう素通しした薄いスレ集約(board_kind は
// 検索に不要なので持たない)。
export interface PlazaSearchThread {
  thread_id: string;
  topic: string;
  post_count: number;
  latest_at: string;
  species_id?: string; // HDR-1(A1#4): root投稿代表値(スレのヘッダー観測対象narrowing用)。
  tags: string[]; // BBS-11: タグ方式検索の対象(全投稿のtags[]を合算・重複除去)。
}

export async function collectSearchThreads(s: TruthStore, channel?: string, speciesFilter?: string): Promise<PlazaSearchThread[]> {
  const prefix = channel ? `truth/${POST_TYPE}/${channel}/` : `truth/${POST_TYPE}/`;
  const posts = (await s.listEvents(prefix)).map(dataOf);
  const threads = new Map<string, PlazaSearchThread>();
  for (const p of posts) {
    const tid = str(p.thread_id);
    const t = threads.get(tid) ?? { thread_id: tid, topic: str(p.topic), post_count: 0, latest_at: "", tags: [] as string[] };
    t.post_count += 1;
    if (str(p.created_at) > t.latest_at) t.latest_at = str(p.created_at);
    if (str(p.post_id) === tid) {
      t.topic = str(p.topic); // root post の topic を代表値に採る。
      if (typeof p.species_id === "string") t.species_id = p.species_id;
    }
    for (const tag of Array.isArray(p.tags) ? p.tags : []) {
      if (typeof tag === "string" && !t.tags.includes(tag)) t.tags.push(tag);
    }
    threads.set(tid, t);
  }
  const speciesQ = (speciesFilter ?? "").trim().toLowerCase();
  const list = [...threads.values()];
  return speciesQ ? list.filter((t) => (t.species_id ?? "").toLowerCase() === speciesQ) : list;
}

// normalizeSearchText — 小文字化+空白除去のみ(不変条項①: embedding/FAISS/LLM 不使用の
// 決定論正規化)。
function normalizeSearchText(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "");
}

// 文字2-gram(bigram)化。日本語は単語間スペースが無いため単語トークン化ができず、
// 素の部分文字列一致(rankThreadSearch の従来ロジック)は言い換え・語尾差分に弱い
// (T-72 KNW wave1 実測: 「コバエがわいた時どうする」は「コバエが大量発生した」の
// 部分文字列でないため matches:[] になっていた)。1文字しか無い場合は bigram が
// 作れないため、その1文字自体を要素とする配列にフォールバック(文字集合オーバー
// ラップ相当)。
function bigrams(s: string): string[] {
  if (s.length < 2) return s.length ? [s] : [];
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

// diceCoefficient — 2·|共通bigram(多重集合)| / (|bigram(a)|+|bigram(b)|)。
// embedding/LLM不使用の決定論ファジー類似度(不変条項①)。同一 bigram が両方に
// 複数回出ても片方ずつ消費して数える(多重集合交差・水増し防止)。
function diceCoefficient(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.length || !B.length) return 0;
  const counts = new Map<string, number>();
  for (const g of B) counts.set(g, (counts.get(g) ?? 0) + 1);
  let intersect = 0;
  for (const g of A) {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      intersect++;
      counts.set(g, c - 1);
    }
  }
  return (2 * intersect) / (A.length + B.length);
}

// ファジー採用の床値。「近い内容があれば これですか?」(ユーザー要件)を満たす
// には、コーディネーター指定の 0.3 では実測不足だった: 「コバエがわいた時
// どうする」対「コバエが大量発生した — 対策まとめ」の実測 dice は 0.2308
// (node で実測・下記コメント参照)、section1 の部分クエリ「コバエわいた」は
// 0.2。どちらも 0.3 未満で削られてしまうため、実測値に安全マージンを残して
// 0.15 へ下げた(無関係ペア「梱包のコツ」は実測 dice=0 なので 0 より大きい
// 床であれば何であれ弾ける=床を下げても無関係ペアが漏れるリスクは無い)。
// ponytail: 短い文字列同士は bigram 1個の一致でも dice が跳ね上がりやすい
// (例: 3文字語同士が bigram を1個共有すると dice=0.5)。これは bigram Dice
// 係数そのものの既知の限界で、長さ考慮の重み付けを足せば緩和できるが本タスク
// では過剰実装(YAGNI)。ノイズ報告が来たら見直す。
const KNW_FUZZY_FLOOR = 0.15;

// rankThreadSearch — 「これ?」候補ランキング(純関数・TruthStore 非依存でテスト可能)。
// (1) 正規化後の完全部分文字列一致(最優先=1000点)、(2) 先頭一致(prefix・直接マッチを
// 中間一致より上に出す=+100点)、(3) クエリを空白区切りトークンへ分割した各トークンの
// 部分一致(10点/トークン)を加点、(4) 文字bigramのDice係数によるファジー類似度加点
// (最大+600・部分文字列一致より必ず下位)。(1)〜(3)のいずれかにヒットするか、Dice
// 係数が KNW_FUZZY_FLOOR 以上のスレのみ候補に残す(単発の偶然一致ノイズを排除)。
// 同点は latest_at 降順→thread_id 昇順で安定ソート(同一入力→同一出力・決定論)。
// 上位5件のみ返す。
export function rankThreadSearch(
  threads: PlazaSearchThread[],
  query: string,
): (PlazaSearchThread & { score: number })[] {
  const q = query.trim();
  if (!q) return [];
  const normQ = normalizeSearchText(q);
  const tokens = q.split(/\s+/).filter(Boolean).map(normalizeSearchText);
  const scored = threads
    .map((t) => {
      const normTopic = normalizeSearchText(t.topic);
      let hit = 0;
      if (normQ && normTopic.includes(normQ)) hit += 1000;
      if (normQ && normTopic.startsWith(normQ)) hit += 100;
      for (const tok of tokens) {
        if (tok && normTopic.includes(tok)) hit += 10;
      }
      const dice = diceCoefficient(normQ, normTopic);
      const score = hit + Math.round(dice * 600);
      return { ...t, score, hit, dice };
    })
    .filter((t) => t.hit > 0 || t.dice >= KNW_FUZZY_FLOOR)
    .map(({ hit: _hit, dice: _dice, ...rest }) => rest);
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.latest_at !== b.latest_at) return a.latest_at < b.latest_at ? 1 : -1;
    return a.thread_id < b.thread_id ? -1 : 1;
  });
  return scored.slice(0, 5);
}

// rankThreadSearchByTag — BBS-11「タグ方式」。クエリをタグそのもの(完全一致・大小無視)
// として thread.tags[] に照合する。自然言語方式(rankThreadSearch)とは別の軸(表記ゆれに
// 強い代わりに言い換えには弱い)なのであえて別関数のまま保つ(統合しない)。
export function rankThreadSearchByTag(
  threads: PlazaSearchThread[],
  query: string,
): (PlazaSearchThread & { score: number })[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored = threads
    .filter((t) => t.tags.some((tag) => tag.toLowerCase() === q))
    .map((t) => ({ ...t, score: 1000 }));
  scored.sort((a, b) => (a.latest_at !== b.latest_at ? (a.latest_at < b.latest_at ? 1 : -1) : a.thread_id < b.thread_id ? -1 : 1));
  return scored.slice(0, 5);
}

// GET /plaza/search?q=<text>&channel=<optional>&species=<optional>&mode=<nl|tag|rag> —
// 決定論スレ検索投影。BBS-11「自然言語/タグ/RAGの3方式」: mode省略時はnl(既定・従来動作)。
// mode=tag はタグ完全一致(rankThreadSearchByTag)。mode=rag は要件文どおり用意するが、
// embedding/ベクトル検索は不変条項①(LLM既定OFF)によりこのラウンドでは未配線のため、
// nl方式と同じ決定論ランキングにフォールバックし `rag_fallback:true` を明示する
// (WIK-24のembedding空スロットと同型のupgrade path・誠実表示のため「RAGで検索した」と
// 偽らない)。
// 空 q は空配列(エラーにしない)。読み取り専用・Truth 追記なし。T-70 KNW wave1(知の広場
// ハブ実物採用): 各マッチに resolved(✔解決済みバッジ表示可否)を同梱。既存
// projectResolution(BBS-05・OQ-PLZ-03)をマッチ上位5件だけに適用する薄い追加投影
// (常駐 index 無し・都度再計算)。?species= は HDR-1(A1#4)ヘッダー観測対象narrowing。
plazaRoutes.get("/plaza/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const channel = c.req.query("channel") || undefined;
  const species = c.req.query("species") || undefined;
  const mode = c.req.query("mode") || "nl";
  if (!q.trim()) return c.json({ query: q, mode, matches: [] });
  const s = store(c);
  const threads = await collectSearchThreads(s, channel, species);
  const ragFallback = mode === "rag";
  const ranked = mode === "tag" ? rankThreadSearchByTag(threads, q) : rankThreadSearch(threads, q);
  const matches = await Promise.all(
    ranked.map(async (t) => ({ ...t, resolved: (await projectResolution(s, t.thread_id)).resolved })),
  );
  return c.json(ragFallback ? { query: q, mode, rag_fallback: true, matches } : { query: q, mode, matches });
});

// ── 改善要求 優先度キュー(BBS-14)────────────────────────────────────────
// projectImprovementQueue — board_kind=improvement のスレ(root post=thread_id)を
// プラチナ投票合計(target_id=thread_id・既存 KRM-25 基盤を再利用・GOV-07/MKT-35 と同一方式)
// でコイン降順に並べた運営者向け優先度キュー。閾値到達(既定 100 票)で official=true
// (自動公式化・実際の公式化=人間ゲートは変わらず、ここは投影のフラグのみ)。
// notify_admin は「管理者へ通知する」の投影側実装(pull型・push メール送信は mail.ts の
// RESEND_API_KEY 実鍵配線と同じ人間ゲート待ちのため対象外・upgrade path として残す)。
export interface ImprovementQueueRow {
  thread_id: string;
  topic: string;
  post_count: number;
  votes: number;
  official_threshold: number;
  official: boolean;
  notify_admin: boolean;
}

export async function projectImprovementQueue(s: TruthStore, channel: string): Promise<ImprovementQueueRow[]> {
  const { boards } = await projectChannelThreads(s, channel);
  const threshold = resolvePolicyInt(OFFICIAL_THRESHOLD_KEY, [], OFFICIAL_THRESHOLD_DEFAULT);
  const rows = await Promise.all(
    (boards.improvement ?? []).map(async (t) => {
      const tally = await projectPlatinumVoteTally(s, t.thread_id, threshold);
      return {
        thread_id: t.thread_id,
        topic: t.topic,
        post_count: t.post_count,
        votes: tally.total,
        official_threshold: tally.official_threshold,
        official: tally.candidate,
        notify_admin: tally.candidate,
      };
    }),
  );
  return rows.sort((a, b) => b.votes - a.votes || (a.thread_id < b.thread_id ? -1 : 1));
}

// GET /plaza/channels/:channel/improvement-queue — 運営者向け優先度キュー投影(BBS-14)。
// コインを積んだ順(降順)に並ぶ=「コインを積んだ順に上から本人がレビュー」の投影。
plazaRoutes.get("/plaza/channels/:channel/improvement-queue", async (c) => {
  return c.json({ channel: c.req.param("channel"), queue: await projectImprovementQueue(store(c), c.req.param("channel")) });
});

// findPostById — 単一投稿の解決(post_id 全走査一致)。他ファイル(plaza-dispute-routes.ts の
// BBS-06/08 指摘対象解決)からの再利用のため export する(重複実装禁止・reuse-first)。
export async function findPostById(s: TruthStore, postId: string): Promise<Record<string, unknown> | null> {
  const post = (await s.listEvents(`truth/${POST_TYPE}/`)).map(dataOf).find((d) => d.post_id === postId);
  return post ?? null;
}

// GET /plaza/posts/:post_id — 単一投稿(permalink 不変・全走査で post_id 一致)。
plazaRoutes.get("/plaza/posts/:post_id", async (c) => {
  const post = await findPostById(store(c), c.req.param("post_id"));
  if (!post) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json({ post });
});

// ── Stance / Consensus(BBS-36)─────────────────────────────────────────
// POST /plaza/stances — 賛否表明を append。キー
// truth/ihl.plaza.stance.v1/<statement_id>/<stance_id>.json。value enum は schema gate。
plazaRoutes.post("/plaza/stances", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const statementId = str(body?.statement_id);
  if (!statementId) return c.json({ error: "INVALID_STANCE", details: ["statement_id required"] }, 400);
  const actorId = c.get("actorId");
  const stanceId = str(body?.stance_id) || ulid();
  const data: Record<string, unknown> = {
    stance_id: stanceId,
    actor_id: actorId,
    statement_id: statementId,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (body?.value !== undefined) data.value = body.value;
  const key = `truth/${STANCE_TYPE}/${statementId}/${stanceId}.json`;
  const res = await store(c).putEventAt(key, envelope(STANCE_TYPE, STANCE_SCHEMA, stanceId, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_STANCE", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_STANCE", key: res.key }, 409);
  return c.json({ stance_id: stanceId }, 201);
});

// projectConsensus — statement ごとに stance を scan → actor ごと最新 ULID を latest として
// 採用(append-only 上書き)→ agree/disagree/pass 計数。consensus/divisive は純算術閾値
// (§2.5・クラスタリング/LLM なし=同入力同出力)。per-statement 配列を返す(批評家#2)。
// actorWeights(OQ-PLZ-02・round-16裁定)は actor_id→重み係数の対応表を呼び手が注入する
// 設計(認定飼育者2.0/一次観測者1.5の初期値・plaza-constants.ts)。未指定 actor は既定 1 票
// (省略時=空map=全員1票=既存呼び出しと完全後方互換)。identity/certification の正本は
// 未着手のため actor_id→role の解決は本関数の対象外(呼び手が role map を用意する)。
export async function projectConsensus(
  s: TruthStore,
  statementIds: string[],
  actorWeights: Record<string, number> = {},
) {
  const out: { statement_id: string; agree: number; disagree: number; pass: number; consensus: boolean; divisive: boolean }[] = [];
  for (const sid of statementIds) {
    const stances = (await s.listEvents(`truth/${STANCE_TYPE}/${sid}/`)).map(dataOf);
    const latest = new Map<string, Record<string, unknown>>();
    for (const st of stances) {
      const prev = latest.get(str(st.actor_id));
      if (!prev || str(st.stance_id) > str(prev.stance_id)) latest.set(str(st.actor_id), st);
    }
    let agree = 0, disagree = 0, pass = 0;
    for (const [actor, st] of latest) {
      const w = actorWeights[actor] ?? 1;
      if (st.value === "agree") agree += w;
      else if (st.value === "disagree") disagree += w;
      else if (st.value === "pass") pass += w;
    }
    const decisive = agree + disagree;
    const consensus = decisive >= CONSENSUS_MIN_VOTES && agree / decisive >= CONSENSUS_AGREE_RATIO;
    const divisive = decisive >= CONSENSUS_MIN_VOTES && Math.min(agree, disagree) / decisive >= DIVISIVE_MIN_SIDE_RATIO;
    out.push({ statement_id: sid, agree, disagree, pass, consensus, divisive });
  }
  return out;
}

// ── 解決マーク(BBS-05・OQ-PLZ-03)───────────────────────────────────────
// projectResolution — スレの解決マーク投影。取消は新イベント(action=unresolve)の追記
// (append-only・supersedeパターン)で表現し、resolution_id(ULID)昇順の最後を現在値とする。
export async function projectResolution(s: TruthStore, threadId: string) {
  const events = (await s.listEvents(`truth/${RESOLUTION_TYPE}/${threadId}/`))
    .map(dataOf)
    .sort((a, b) => (str(a.resolution_id) < str(b.resolution_id) ? -1 : 1));
  const latest = events[events.length - 1];
  const resolved = latest?.action === "resolve";
  return {
    resolved,
    resolved_at: resolved ? str(latest!.created_at) : undefined,
    note: resolved && typeof latest!.note === "string" ? latest!.note : undefined,
  };
}

// POST /plaza/threads/:thread_id/resolution — [✔解決した]/[取り消す](OQ-PLZ-03: 権限は
// スレ主のみ・root post=thread_id と同じ post_id の actor_id と一致必須)。append-only
// (取消は unresolve イベントの追記・元イベントは不変)。
plazaRoutes.post("/plaza/threads/:thread_id/resolution", async (c) => {
  const threadId = c.req.param("thread_id");
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action === "unresolve" ? "unresolve" : body?.action === "resolve" ? "resolve" : "";
  if (!action) return c.json({ error: "INVALID_RESOLUTION", details: ["action must be resolve|unresolve"] }, 400);

  const s = store(c);
  const view = await projectThread(s, threadId);
  if (!view) return c.json({ error: "NOT_FOUND" }, 404);
  const actorId = c.get("actorId");
  const rootPost = view.posts.find((p) => str(p.post_id) === threadId);
  const ownerId = str(rootPost?.actor_id);
  if (!ownerId || ownerId !== actorId) return c.json({ error: "FORBIDDEN", details: ["thread owner only"] }, 403);

  const resolutionId = str(body?.resolution_id) || ulid();
  const data: Record<string, unknown> = {
    resolution_id: resolutionId,
    actor_id: actorId,
    thread_id: threadId,
    action,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (action === "resolve" && typeof body?.note === "string" && body.note) data.note = body.note;
  const key = `truth/${RESOLUTION_TYPE}/${threadId}/${resolutionId}.json`;
  const res = await s.putEventAt(key, envelope(RESOLUTION_TYPE, RESOLUTION_SCHEMA, resolutionId, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_RESOLUTION", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_RESOLUTION", key: res.key }, 409);
  return c.json({ resolution_id: resolutionId, action }, 201);
});

// ── 昇格ステータス(OQ-PLZ-01・仮値4/2/5/12・round-16裁定)──────────────────
// projectPromotionStatus — 実観測cite件数(post.cite_refs type=observation の重複無し件数)・
// 追試件数(ihl.plaza.signal.v1・target_type="plaza_thread"・signal=retry_reproduced/
// retry_not_reproduced)・stance母数(projectConsensus)から昇格状態を算術判定する。
// 「⚠反証あり」は自動判定してよい降格方向(§F3 設計注記)のため verified より優先する。
// 認定飼育者/一次観測者の重み付き票(OQ-PLZ-02)は identity/certification の正本が未着手の
// ため本関数には未算入(projectConsensus の actorWeights 引数で個別に対応可能)。
export type PromotionStatus = "verified" | "refuted" | "unresolved" | "open";
export interface PromotionResult {
  status: PromotionStatus;
  cite_count: number;
  retry_reproduced: number;
  retry_not_reproduced: number;
  stance_total: number;
}

// classifyPromotion — 4カウント→PromotionStatus の純算術判定(閾値は plaza-constants.ts
// 単一正本)。projectPromotionStatus と reduceSpeciesBook(章単位の合算カウント)の両方が
// この1関数を通す(root-cause reuse・判定式の二重実装を避ける)。
export function classifyPromotion(counts: {
  cite_count: number;
  retry_reproduced: number;
  retry_not_reproduced: number;
  stance_total: number;
}): PromotionStatus {
  const verified = counts.cite_count >= PLZ_VERIFIED_CITE_MIN && counts.retry_reproduced >= PLZ_VERIFIED_RETRY_MIN;
  const refuted = counts.retry_not_reproduced >= PLZ_REFUTED_RETRY_MIN;
  const unresolved = !verified && !refuted && counts.stance_total >= PLZ_UNRESOLVED_STANCE_MIN;
  return refuted ? "refuted" : verified ? "verified" : unresolved ? "unresolved" : "open";
}

export async function projectPromotionStatus(s: TruthStore, threadId: string): Promise<PromotionResult> {
  const posts = (await s.listEvents(`truth/${POST_TYPE}/`)).map(dataOf).filter((d) => d.thread_id === threadId);
  const citeSet = new Set<string>();
  for (const p of posts) {
    for (const ref of (p.cite_refs as CiteRef[] | undefined) ?? []) {
      if (ref.type === "observation") citeSet.add(ref.id);
    }
  }
  const signals = (await s.listEvents(`truth/${SIGNAL_TYPE}/plaza_thread/${threadId}/`)).map(dataOf);
  const reproduced = signals.filter((sg) => sg.signal === "retry_reproduced").length;
  const notReproduced = signals.filter((sg) => sg.signal === "retry_not_reproduced").length;

  const statementIds = posts.map((p) => str(p.post_id));
  const consensus = await projectConsensus(s, statementIds);
  const stanceTotal = consensus.reduce((sum, row) => sum + row.agree + row.disagree + row.pass, 0);

  const counts = { cite_count: citeSet.size, retry_reproduced: reproduced, retry_not_reproduced: notReproduced, stance_total: stanceTotal };
  return { status: classifyPromotion(counts), ...counts };
}

// GET /plaza/threads/:thread_id/consensus — スレ内 post_id を statement_ids として収集し
// per-statement consensus を返す(批評家#2)。
plazaRoutes.get("/plaza/threads/:thread_id/consensus", async (c) => {
  const threadId = c.req.param("thread_id");
  const posts = (await store(c).listEvents(`truth/${POST_TYPE}/`)).map(dataOf).filter((d) => d.thread_id === threadId);
  const statementIds = posts.map((p) => str(p.post_id));
  const statements = await projectConsensus(store(c), statementIds);
  // c9 wave1 KNW Slice2(スレッドの生ID撲滅): the consensus table's UI column
  // showed the raw statement_id (= post_id ULID) — attach a readable excerpt
  // of the statement's own post body so the UI never has to render the id.
  // Read-side projection only (statement_id itself is kept, not replaced).
  const bodyById = new Map(posts.map((p) => [str(p.post_id), str(p.body)]));
  const withExcerpt = statements.map((s) => {
    const body = bodyById.get(s.statement_id) ?? "";
    return { ...s, excerpt: body.length > 30 ? `${body.slice(0, 30)}…` : body };
  });
  return c.json({ thread_id: threadId, statements: withExcerpt });
});

// ── Fork / Rank(BBS-29/GOV-19/23)──────────────────────────────────────
// POST /plaza/forks — fork 公開を append。キー truth/ihl.plaza.fork.v1/<target_type>/<fork_id>.json。
// 全 fork 非削除で共存(DELETE 無し)。visibility/target_type enum は schema gate。
plazaRoutes.post("/plaza/forks", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const targetType = str(body?.target_type);
  if (!targetType) return c.json({ error: "INVALID_FORK", details: ["target_type required"] }, 400);
  const actorId = c.get("actorId");
  const forkId = str(body?.fork_id) || ulid();
  const data: Record<string, unknown> = {
    fork_id: forkId,
    actor_id: actorId,
    target_type: targetType,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (body?.forked_from !== undefined) data.forked_from = body.forked_from;
  if (body?.visibility !== undefined) data.visibility = body.visibility;
  if (body?.title !== undefined) data.title = body.title;
  if (typeof body?.content_hash === "string") data.content_hash = body.content_hash;
  // V3-MKT-47: docker_extension/world_template の改ざん検知チェーン(lineage-meta と
  // 同じ連鎖ハッシュ規約・任意)。
  if (typeof body?.lineage_hash === "string") data.lineage_hash = body.lineage_hash;
  const key = `truth/${FORK_TYPE}/${targetType}/${forkId}.json`;
  const res = await store(c).putEventAt(key, envelope(FORK_TYPE, FORK_SCHEMA, forkId, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_FORK", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_FORK", key: res.key }, 409);
  return c.json({ fork_id: forkId }, 201);
});

// reduceForkRank — 初期 rank(public→beginner / private→非掲載=null)に gov.vote(kind=
// fork_rank)の最新 approve(rank_to ∈ FORK_RANKS)を畳んで effective rank を算出。
export function reduceForkRank(fork: Record<string, unknown>, votes: Record<string, unknown>[]): string | null {
  let rank: string | null = fork.visibility === "public" ? "beginner" : null;
  const approves = votes
    .filter((v) => v.value === "approve" && FORK_RANKS.includes(str(v.rank_to) as (typeof FORK_RANKS)[number]))
    .sort((a, b) => (str(a.vote_id) < str(b.vote_id) ? -1 : 1));
  if (approves.length) rank = str(approves[approves.length - 1].rank_to);
  return rank;
}

// projectForkRanks — fork を scan → effective rank を畳み FORK_RANKS 昇順で整列。private
// (rank=null)は非掲載。search=false のとき minor は除外(検索専用・BBS-29)。全 fork 共存。
export async function projectForkRanks(
  s: TruthStore,
  targetType?: string,
  forkedFrom?: string,
  search = false,
) {
  let forks = (await s.listEvents(`truth/${FORK_TYPE}/`)).map(dataOf);
  if (targetType) forks = forks.filter((f) => f.target_type === targetType);
  if (forkedFrom) forks = forks.filter((f) => f.forked_from === forkedFrom);
  const votes = (await s.listEvents(`truth/${VOTE_TYPE}/`)).map(dataOf).filter((v) => v.kind === "fork_rank");
  const votesByFork = new Map<string, Record<string, unknown>[]>();
  for (const v of votes) {
    const t = str(v.proposal_target);
    (votesByFork.get(t) ?? votesByFork.set(t, []).get(t)!).push(v);
  }
  return forks
    .map((f) => ({
      fork_id: str(f.fork_id),
      target_type: str(f.target_type),
      title: str(f.title),
      visibility: str(f.visibility),
      forked_from: str(f.forked_from),
      content_hash: typeof f.content_hash === "string" ? f.content_hash : undefined,
      rank: reduceForkRank(f, votesByFork.get(str(f.fork_id)) ?? []),
    }))
    .filter((f): f is typeof f & { rank: string } => f.rank !== null)
    .filter((f) => search || f.rank !== "minor")
    .sort((a, b) => FORK_RANKS.indexOf(a.rank as (typeof FORK_RANKS)[number]) - FORK_RANKS.indexOf(b.rank as (typeof FORK_RANKS)[number]));
}

// GET /plaza/forks — ランク投影(query: target_type, forked_from, search)。
plazaRoutes.get("/plaza/forks", async (c) => {
  const targetType = c.req.query("target_type") || undefined;
  const forkedFrom = c.req.query("forked_from") || undefined;
  const search = c.req.query("search") === "true";
  const forks = await projectForkRanks(store(c), targetType, forkedFrom, search);
  return c.json({ forks });
});

// GET /plaza/forks/:fork_id — 単一 fork(全走査で fork_id 一致)。content_hash 同梱。
plazaRoutes.get("/plaza/forks/:fork_id", async (c) => {
  const forkId = c.req.param("fork_id");
  const fork = (await store(c).listEvents(`truth/${FORK_TYPE}/`)).map(dataOf).find((d) => d.fork_id === forkId);
  if (!fork) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json({ fork });
});

// ── Signal / Ranking(BBS-03/GOV-23)────────────────────────────────────
// POST /plaza/signals — like/use/retain を append。キー
// truth/ihl.plaza.signal.v1/<target_type>/<target_id>/<signal_id>.json。signal enum は schema gate。
plazaRoutes.post("/plaza/signals", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const targetType = str(body?.target_type);
  const targetId = str(body?.target_id);
  if (!targetType || !targetId) return c.json({ error: "INVALID_SIGNAL", details: ["target_type and target_id required"] }, 400);
  const actorId = c.get("actorId");
  const signalId = str(body?.signal_id) || ulid();
  const data: Record<string, unknown> = {
    signal_id: signalId,
    actor_id: actorId,
    target_type: targetType,
    target_id: targetId,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (body?.signal !== undefined) data.signal = body.signal;
  const key = `truth/${SIGNAL_TYPE}/${targetType}/${targetId}/${signalId}.json`;
  const res = await store(c).putEventAt(key, envelope(SIGNAL_TYPE, SIGNAL_SCHEMA, signalId, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_SIGNAL", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_SIGNAL", key: res.key }, 409);
  return c.json({ signal_id: signalId }, 201);
});

// 1 actor 1 票へ畳む(投票水増し防止=批評家 major)。(actor_id, proposal_target, kind) ごとに
// 最新 vote_id(ULID)の 1 件のみ採用。actor は偽装不能な provenance.actor_id を data.actor_id
// より優先(theme-routes projectTemplateVotes と同方式)。full envelope[] を受け deduped data[]
// を返す。threshold/os_promotion/ranking の集計はすべてこの畳込みを通す。
export function dedupVotes(events: Record<string, unknown>[]): Record<string, unknown>[] {
  const latest = new Map<string, Record<string, unknown>>();
  for (const e of events) {
    const d = dataOf(e);
    const prov = (e.provenance ?? {}) as Record<string, unknown>;
    const actor = typeof prov.actor_id === "string" ? prov.actor_id : str(d.actor_id);
    const key = `${actor}\u0000${str(d.proposal_target)}\u0000${str(d.kind)}`;
    const prev = latest.get(key);
    if (!prev || str(d.vote_id) > str(prev.vote_id)) latest.set(key, d);
  }
  return [...latest.values()];
}

// (actor_id, target_id, signal) 単位で最新 signal_id(ULID・生成順単調)のみ採用 —
// dedupVotes(上記)と同型のパターン(T-71 GRAY①/SEC-A6): gov.vote/テンプレ投票は
// 1 actor 1 票へ畳んでいるのに signal(like/use/retain)系だけ連投を畳んでおらず、
// 単一 actor の連投でランキング(GOV-23 OS昇格)を吊り上げられた。
function dedupSignals(events: Record<string, unknown>[]): Record<string, unknown>[] {
  const latest = new Map<string, Record<string, unknown>>();
  for (const e of events) {
    const d = dataOf(e);
    const prov = (e.provenance ?? {}) as Record<string, unknown>;
    const actor = typeof prov.actor_id === "string" ? prov.actor_id : str(d.actor_id);
    const key = `${actor}\u0000${str(d.target_id)}\u0000${str(d.signal)}`;
    const prev = latest.get(key);
    if (!prev || str(d.signal_id) > str(prev.signal_id)) latest.set(key, d);
  }
  return [...latest.values()];
}

// projectRanking — signal(like/use/retain)+ gov.vote approve + fork 数を RANKING_WEIGHTS で
// 加重合算し降順(利用率→ランキング・GOV-23 自然淘汰)。targetType 指定時は signal/fork を絞る。
// signal/vote とも dedup で 1 actor 1 信号/1 票に畳んでから加重(単一 actor の連投で
// score を水増し不能・T-71 GRAY①/SEC-A6)。
export async function projectRanking(s: TruthStore, targetType?: string) {
  type Row = { target_id: string; target_type: string; score: number; breakdown: Record<string, number> };
  const rows = new Map<string, Row>();
  const row = (id: string, tt: string): Row => {
    let r = rows.get(id);
    if (!r) {
      r = { target_id: id, target_type: tt, score: 0, breakdown: { like: 0, use: 0, retain: 0, vote: 0, fork: 0 } };
      rows.set(id, r);
    }
    return r;
  };

  let signals = dedupSignals(await s.listEvents(`truth/${SIGNAL_TYPE}/`));
  if (targetType) signals = signals.filter((sg) => sg.target_type === targetType);
  for (const sg of signals) {
    const kind = str(sg.signal) as keyof typeof RANKING_WEIGHTS;
    const w = RANKING_WEIGHTS[kind];
    if (!w) continue;
    const r = row(str(sg.target_id), str(sg.target_type));
    r.score += w;
    r.breakdown[kind] += 1;
  }

  const votes = dedupVotes(await s.listEvents(`truth/${VOTE_TYPE}/`)).filter((v) => v.value === "approve");
  for (const v of votes) {
    const r = row(str(v.proposal_target), "");
    r.score += RANKING_WEIGHTS.vote;
    r.breakdown.vote += 1;
  }

  let forks = (await s.listEvents(`truth/${FORK_TYPE}/`)).map(dataOf);
  if (targetType) forks = forks.filter((f) => f.target_type === targetType);
  for (const f of forks) {
    const parent = str(f.forked_from);
    if (!parent) continue;
    const r = row(parent, "");
    r.score += RANKING_WEIGHTS.fork;
    r.breakdown.fork += 1;
  }

  return [...rows.values()].sort((a, b) => (b.score - a.score) || (a.target_id < b.target_id ? -1 : 1));
}

// GET /plaza/ranking — ランキング投影(query: target_type)。
plazaRoutes.get("/plaza/ranking", async (c) => {
  const targetType = c.req.query("target_type") || undefined;
  const ranking = await projectRanking(store(c), targetType);
  return c.json({ ranking });
});

// ── Summary(BBS-10・4層)───────────────────────────────────────────────
// POST /plaza/summaries — 要約を append。キー
// truth/ihl.plaza.summary.v1/<thread_id>/<block_index>-<summary_id>.json。current_summary は
// 空文字許容(空スロット=手動/バッチが後日埋める・LLM 直呼びなし)。block_index 省略時は
// 現スレ post 数から floor((n-1)/SUMMARY_BLOCK_SIZE) を算出。generator enum は schema gate。
plazaRoutes.post("/plaza/summaries", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const threadId = str(body?.thread_id);
  if (!threadId) return c.json({ error: "INVALID_SUMMARY", details: ["thread_id required"] }, 400);
  const actorId = c.get("actorId");
  const summaryId = str(body?.summary_id) || ulid();

  let blockIndex: number;
  if (Number.isInteger(body?.block_index)) {
    blockIndex = body!.block_index as number;
  } else {
    const n = (await store(c).listEvents(`truth/${POST_TYPE}/`)).map(dataOf).filter((d) => d.thread_id === threadId).length;
    blockIndex = Math.floor((n === 0 ? 0 : n - 1) / SUMMARY_BLOCK_SIZE);
  }

  const data: Record<string, unknown> = {
    summary_id: summaryId,
    thread_id: threadId,
    block_index: blockIndex,
    current_summary: typeof body?.current_summary === "string" ? body.current_summary : "",
    generator: body?.generator !== undefined ? body.generator : "manual",
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (Array.isArray(body?.open_questions)) data.open_questions = body.open_questions;
  if (typeof body?.diff === "string") data.diff = body.diff;

  const key = `truth/${SUMMARY_TYPE}/${threadId}/${blockIndex}-${summaryId}.json`;
  const res = await store(c).putEventAt(key, envelope(SUMMARY_TYPE, SUMMARY_SCHEMA, summaryId, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_SUMMARY", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_SUMMARY", key: res.key }, 409);
  return c.json({ summary_id: summaryId, block_index: blockIndex }, 201);
});

// projectSummary — 4層(§2.3): (1)post embedding 参照(CL-08 manifest・空スロット)、
// (2)block 要約 embedding 参照、(3)current_summary+open_questions=最新 summary、
// (4)diff 履歴=全 summary の diff 列。block_index=floor(post 通番/SUMMARY_BLOCK_SIZE)。
// 要約本文空許容・LLM 呼び出しゼロ。
export async function projectSummary(s: TruthStore, threadId: string) {
  const postCount = (await s.listEvents(`truth/${POST_TYPE}/`)).map(dataOf).filter((d) => d.thread_id === threadId).length;
  const summaries = (await s.listEvents(`truth/${SUMMARY_TYPE}/${threadId}/`))
    .map(dataOf)
    .sort((a, b) => {
      const ba = Number(a.block_index ?? 0);
      const bb = Number(b.block_index ?? 0);
      if (ba !== bb) return ba - bb;
      return str(a.summary_id) < str(b.summary_id) ? -1 : 1;
    });
  const latest = summaries[summaries.length - 1];
  return {
    thread_id: threadId,
    block_size: SUMMARY_BLOCK_SIZE,
    post_count: postCount,
    current_block_index: Math.floor((postCount === 0 ? 0 : postCount - 1) / SUMMARY_BLOCK_SIZE),
    // layer 1/2: embedding は空スロット参照(ベクトル本体は後日バッチ・LLM 直呼びなし)。
    post_embedding: EMBEDDING_REF,
    block_embedding: EMBEDDING_REF,
    // layer 3: 最新 summary の本文 + 未解決論点(空スロット許容)。
    current_summary: latest ? str(latest.current_summary) : "",
    open_questions: (latest?.open_questions as string[] | undefined) ?? [],
    // layer 4: diff 履歴。
    diff_history: summaries
      .filter((sm) => typeof sm.diff === "string")
      .map((sm) => ({ block_index: Number(sm.block_index ?? 0), diff: str(sm.diff), at: str(sm.created_at) })),
  };
}

// GET /plaza/threads/:thread_id/summary — 4層要約投影。
plazaRoutes.get("/plaza/threads/:thread_id/summary", async (c) => {
  return c.json(await projectSummary(store(c), c.req.param("thread_id")));
});

// ── 種族の本(wave1 KNW・R133・decision-cards-plain-language 準拠)──────────────
// 1 species_id = 1 冊。投稿を species_id × topic(=章)で束ね、章ごとに昇格状態
// (classifyPromotion 再利用)と「今わかっていること」を出す。board_kind には
// 依存しない(4分類は章の集約キーではない)。block_index(要約4層)は横展開しない
// (読み取りは都度算出のみ)。AI 不使用・決定論のみ。
export interface SpeciesBookPostInput {
  post_id: string;
  thread_id: string;
  topic: string;
  body: string;
  created_at: string; // RFC3339
  observation_cite_count: number; // この投稿の cite_refs のうち type==="observation" の重複無し件数
}
export interface SpeciesBookHistoryEntry {
  diff: string;
  at: string;
}
export interface SpeciesBookChapter {
  topic: string;
  thread_count: number;
  post_count: number;
  latest_at: string;
  status: PromotionStatus;
  cite_count: number;
  retry_reproduced: number;
  retry_not_reproduced: number;
  stance_total: number;
  answer: string;
  answer_verified: boolean;
  history: SpeciesBookHistoryEntry[];
}
export interface SpeciesBook {
  species_id: string;
  species_name: string;
  chapter_count: number;
  thread_count: number;
  verified_count: number;
  chapters: SpeciesBookChapter[];
}

// reduceSpeciesBook — 純関数(store非依存・rankThreadSearch/dedupVotes/reduceForkRank と
// 同型)。章の集約キーは species_id×topic のみ(呼び手が posts を既に絞り込んでいる前提)。
export function reduceSpeciesBook(
  speciesId: string,
  speciesName: string,
  posts: SpeciesBookPostInput[],
  promotionByThread: Record<string, { cite_count: number; retry_reproduced: number; retry_not_reproduced: number; stance_total: number }>,
  historyByThread: Record<string, SpeciesBookHistoryEntry[]>,
): SpeciesBook {
  const byTopic = new Map<string, SpeciesBookPostInput[]>();
  for (const p of posts) {
    (byTopic.get(p.topic) ?? byTopic.set(p.topic, []).get(p.topic)!).push(p);
  }

  const chapters: SpeciesBookChapter[] = [...byTopic.entries()].map(([topic, topicPosts]) => {
    const threadIds = [...new Set(topicPosts.map((p) => p.thread_id))];

    const counts = { cite_count: 0, retry_reproduced: 0, retry_not_reproduced: 0, stance_total: 0 };
    for (const tid of threadIds) {
      const c = promotionByThread[tid];
      if (!c) continue;
      counts.cite_count += c.cite_count;
      counts.retry_reproduced += c.retry_reproduced;
      counts.retry_not_reproduced += c.retry_not_reproduced;
      counts.stance_total += c.stance_total;
    }
    const status = classifyPromotion(counts);

    // answer: observation_cite_count 最大の投稿の body(同数は created_at 新しい方→
    // post_id 昇順で決定論的に一意化)。全て0件でも投稿があれば最新投稿の body。
    const best = [...topicPosts].sort((a, b) => {
      if (b.observation_cite_count !== a.observation_cite_count) return b.observation_cite_count - a.observation_cite_count;
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
      return a.post_id < b.post_id ? -1 : 1;
    })[0];

    const history = threadIds
      .flatMap((tid) => historyByThread[tid] ?? [])
      .sort((a, b) => (a.at !== b.at ? (a.at < b.at ? -1 : 1) : a.diff < b.diff ? -1 : a.diff > b.diff ? 1 : 0));

    let latestAt = "";
    for (const p of topicPosts) if (p.created_at > latestAt) latestAt = p.created_at;

    return {
      topic,
      thread_count: threadIds.length,
      post_count: topicPosts.length,
      latest_at: latestAt,
      status,
      ...counts,
      answer: best ? best.body : "",
      answer_verified: status === "verified",
      history,
    };
  });

  chapters.sort((a, b) => (b.post_count !== a.post_count ? b.post_count - a.post_count : a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0));

  return {
    species_id: speciesId,
    species_name: speciesName,
    chapter_count: chapters.length,
    thread_count: new Set(posts.map((p) => p.thread_id)).size,
    verified_count: chapters.filter((ch) => ch.status === "verified").length,
    chapters,
  };
}

// projectSpeciesBook — store配線。species_id は SW-1 で plaza-post スキーマへ
// 追加済み(schemas/events/plaza-post.schema.json)。付与された投稿だけがこの本に
// 載る(未付与の投稿は素通し=ヒット0=空の本は正常系)。投稿フォーム側がこの
// フィールドを自動で添える配線はまだ無い(wave1 KNW「種族の本」の申し送り —
// renderer.tsx SpeciesBookNode の footer 参照)。
export async function projectSpeciesBook(s: TruthStore, speciesId: string): Promise<SpeciesBook> {
  const allPosts = (await s.listEvents(`truth/${POST_TYPE}/`)).map(dataOf);
  const posts = allPosts.filter((d) => (d as { species_id?: unknown }).species_id === speciesId);

  const bookPosts: SpeciesBookPostInput[] = posts.map((p) => {
    const citeSet = new Set<string>();
    for (const ref of (p.cite_refs as CiteRef[] | undefined) ?? []) {
      if (ref.type === "observation") citeSet.add(ref.id);
    }
    return {
      post_id: str(p.post_id),
      thread_id: str(p.thread_id),
      topic: str(p.topic),
      body: str(p.body),
      created_at: str(p.created_at),
      observation_cite_count: citeSet.size,
    };
  });

  const threadIds = [...new Set(bookPosts.map((p) => p.thread_id))];
  const promotionByThread: Record<string, { cite_count: number; retry_reproduced: number; retry_not_reproduced: number; stance_total: number }> = {};
  const historyByThread: Record<string, SpeciesBookHistoryEntry[]> = {};
  await Promise.all(
    threadIds.map(async (tid) => {
      const [promo, summary] = await Promise.all([projectPromotionStatus(s, tid), projectSummary(s, tid)]);
      promotionByThread[tid] = promo;
      historyByThread[tid] = summary.diff_history.map((h) => ({ diff: h.diff, at: h.at }));
    }),
  );

  // ponytail: 種マスタは taxon-routes.ts に専用 route はあるが再利用可能な export された
  // 投影関数が無いため、同じ put-if-absent キー規約で直接1件読む(無ければ speciesId を
  // そのまま name に落とす=過剰実装を避ける)。
  const master = await s.readEvent(`truth/ihl.taxon.species.v1/${speciesId}.json`);
  const speciesName = master ? str(dataOf(master).name) || speciesId : speciesId;

  return reduceSpeciesBook(speciesId, speciesName, bookPosts, promotionByThread, historyByThread);
}

// GET /plaza/species/:species_id/book — 種族の本(読み取り専用投影・Truth追記なし)。
plazaRoutes.get("/plaza/species/:species_id/book", async (c) => {
  return c.json(await projectSpeciesBook(store(c), c.req.param("species_id")));
});

// ── BBS-25: 統一ノードビュー ───────────────────────────────────────────────
// 全投稿型(article/observation/specimen/paper/review/thread/appeal/cancel相当。本実装は
// board_kind/paper_case/tags で型を表現し新規フィールドは増やさない・既存 tags[] 再利用)を
// /plaza/node/:post_id の単一ビューで表示する。BBS(Discourse代替のJSONLミラー方式)は
// 既存 Truth event(1 post = 1 append-only JSON envelope)がそのままミラー実体であり、
// 新規ストレージは作らない(reuse-first)。>>N 引用は cite_refs(既存 CiteRef type="post")を
// 既存 citeUrl/parseCiteTokens と同型で解決する。
export interface PlazaNodeView {
  post_id: string;
  node_type: string; // plaza-post は board_kind(paper の場合は paper_case を併記)。
  // content/ppr-cycle-node は dispatchNode の node_kind をそのまま使う。
  channel: string; // plaza-post 以外は空文字(該当概念が無い)。
  thread_id: string; // plaza-post 以外は空文字(該当概念が無い)。
  post: Record<string, unknown>;
  backlinks: string[]; // この id を [ihl:cite type=post id=<id>] で引用している他 post_id
}

// projectNodeView — BBS-25「全投稿型を /node/:nodeId の統一ビューで表示する」の plaza側
// 実装(design35 §A-5)。新しい保存場所は作らず、既存の統一ディスパッチャ(dispatchNode)を
// 1回呼ぶだけにする。以前は plaza-post 専用の全走査ロジックをここに複製していたが
// (62代目HQ検収の指摘=specimen/appeal/cancel等の他イベント型に未対応)、dispatchNode に
// 寄せたことで content / ppr-cycle-node も同じ id 空間から解決できるようになった
// (性能特性はdispatchNode側の注記どおり=content/ppr-cycle-nodeはO(1)・plaza-postのみO(n))。
export async function projectNodeView(s: TruthStore, nodeId: string): Promise<PlazaNodeView | null> {
  const dispatched = await dispatchNode(s, nodeId);
  if (!dispatched) return null;

  const allPosts = (await s.listEvents(`truth/${POST_TYPE}/`)).map(dataOf);
  const backlinks = allPosts
    .filter((p) => ((p.cite_refs as CiteRef[] | undefined) ?? []).some((r) => r.type === "post" && r.id === nodeId))
    .map((p) => str(p.post_id));

  if (dispatched.node_kind === "plaza-post") {
    const post = dispatched.node;
    const boardKind = str(post.board_kind);
    const paperCase = paperCaseOf(post.tags);
    const nodeType = paperCase ? `paper:${paperCase}` : boardKind || "thread";
    return {
      post_id: nodeId,
      node_type: nodeType,
      channel: str(post.channel),
      thread_id: str(post.thread_id),
      post,
      backlinks,
    };
  }

  // content / ppr-cycle-node: plaza 概念(channel/thread_id/board_kind)を持たないため
  // 空文字のまま返す(存在しない概念を捏造しない)。node_type は dispatchNode の種別。
  return {
    post_id: nodeId,
    node_type: dispatched.node_kind,
    channel: "",
    thread_id: "",
    post: dispatched.node,
    backlinks,
  };
}

// GET /plaza/node/:post_id — BBS-25 統一ビュー(読み取り専用・cross-leak防止は既存
// channel スコープ分離をそのまま踏襲=general/component の thread は channel が異なる
// ため collectSearchThreads の channel 引数指定で漏れない)。[2026-08-01 w-plaza2追記]
// dispatchNode 経由化により content / ppr-cycle-node の id もこのルートで解決できる
// (以前は plaza-post のみ)。
plazaRoutes.get("/plaza/node/:post_id", async (c) => {
  const view = await projectNodeView(store(c), c.req.param("post_id"));
  if (!view) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json(view);
});

// ── BBS-11: 掲示板作成前の検索誘導ゲート ───────────────────────────────────
// 自然言語検索(既存 rankThreadSearch)で先に既存スレへ誘導し、結果が十分なら新規作成を
// 抑止提案する。自動作成は行わない(ユーザーの最終判断は常に尊重・派閥等の意図的重複作成は
// 縛らない)。新規作成可否は「提案」であって「強制」ではないため、suggest_create=false でも
// 呼び出し側(UI)は作成を止めない設計とする。
export const BBS11_STRONG_MATCH_SCORE = 500; // dice/prefix 一致相当以上を「結果が十分」とみなす床
export const BBS11_STRONG_MATCH_COUNT = 1; // 上記床を超える候補が1件以上あれば新規作成を抑止提案

export interface CreateCheckResult {
  query: string;
  suggest_create: boolean;
  candidates: (PlazaSearchThread & { score: number })[];
}

export async function projectCreateCheck(s: TruthStore, query: string, channel?: string): Promise<CreateCheckResult> {
  const threads = await collectSearchThreads(s, channel);
  const candidates = rankThreadSearch(threads, query);
  const strongCount = candidates.filter((t) => t.score >= BBS11_STRONG_MATCH_SCORE).length;
  return { query, suggest_create: strongCount < BBS11_STRONG_MATCH_COUNT, candidates };
}

// GET /plaza/create-check?q=<text>&channel=<optional> — 新規スレ作成前の誘導判定(BBS-11)。
plazaRoutes.get("/plaza/create-check", async (c) => {
  const q = c.req.query("q") ?? "";
  if (!q.trim()) return c.json({ query: q, suggest_create: true, candidates: [] });
  return c.json(await projectCreateCheck(store(c), q, c.req.query("channel") || undefined));
});

// ── BBS-12: 掲示板作成AI補助(たたき台自動記入) ─────────────────────────────
// LLM 既定OFF(不変条項①)のため、BBS-14(isOffensiveContent)と同型の決定論フォールバック:
// 自由記述テキストから「作りたいものの説明」を最初の文をtitleに、残りをdescriptionに、
// 頻出語からtagsたたき台を機械的に組み立てる(要約AIではなく決定論スキャフォールド)。
// 実鍵配線後は ai-kernel.ts の generate task へ差し替え可能(BBS-14 と同じ upgrade path)。
const STOPWORDS_JA = new Set(["の", "は", "が", "を", "に", "で", "と", "も", "な", "です", "ます", "した", "する"]);

export interface BoardDraft {
  title: string;
  description: string;
  tags: string[];
  purpose: string;
}

export function draftBoardFromText(freeText: string): BoardDraft {
  const text = freeText.trim();
  const sentences = text.split(/(?<=[。.!?])\s*/).filter(Boolean);
  const title = (sentences[0] ?? text).slice(0, 40);
  const description = sentences.slice(1).join(" ") || text;
  const words = text
    .replace(/[。、.,!?]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOPWORDS_JA.has(w));
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
  const tags = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w);
  return { title, description, purpose: title, tags };
}

// POST /plaza/board-draft { free_text } — ワンクリック作成補助のたたき台生成(Truth追記なし・
// 純関数の投影のみ。実際の掲示板/スレ作成は既存 POST /plaza/posts が担う)。
plazaRoutes.post("/plaza/board-draft", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const freeText = str(body?.free_text);
  if (!freeText.trim()) return c.json({ error: "INVALID_DRAFT", details: ["free_text required"] }, 400);
  return c.json(draftBoardFromText(freeText));
});
