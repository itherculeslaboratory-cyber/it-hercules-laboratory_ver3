// V3-BBS-19: DM/メッセージ機能。スレッド一覧+バブル表示、R2 相当キー dm/{threadId}/... へ
// append-only 保存(TruthStore の put-if-absent 規約=Truth 全体で共通。専用 R2 バケットは
// 追加しない=不変条項①・常駐DB禁止と同じ理由でこのファイルも都度再計算)。送信時
// lastMessageAt は projectDmThread で最新メッセージ時刻から都度導出する(別フィールドとして
// 永続化しない=単一正本)。DM は取引チャット・国際取引・不服申立て・研究共同作業・
// マーケットやり取り全ての基盤となる汎用レイヤーとして thread に context_type を持たせ、
// 各ドメイン(market/trade/appeal/research)はこの thread_id を自分の側で参照する設計とする
// (このファイルは DM 本体のみ実装・各ドメイン側からの配線は各ドメインの担当glob)。
// 全 route PROTECTED(index.ts の auth middleware が actorId を set)。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";

const DM_THREAD_TYPE = "ihl.plaza.dm_thread.v1";
const DM_THREAD_SCHEMA = "schemas/events/plaza-dm-thread.schema.json";
const DM_MESSAGE_TYPE = "ihl.plaza.dm_message.v1";
const DM_MESSAGE_SCHEMA = "schemas/events/plaza-dm-message.schema.json";
const SCHEMA_VERSION = "1";

export const plazaDmRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

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

export interface DmThreadRecord {
  thread_id: string;
  participants: string[];
  context_type: "trade" | "international_trade" | "appeal" | "research" | "market" | "general";
  created_at: string;
}

async function listDmThreads(s: TruthStore): Promise<DmThreadRecord[]> {
  return (await s.listEvents(`truth/${DM_THREAD_TYPE}/`)).map(dataOf) as unknown as DmThreadRecord[];
}

export interface DmMessageRecord {
  message_id: string;
  thread_id: string;
  actor_id: string;
  body: string;
  created_at: string;
}

async function listDmMessages(s: TruthStore, threadId: string): Promise<DmMessageRecord[]> {
  return (await s.listEvents(`truth/${DM_MESSAGE_TYPE}/${threadId}/`))
    .map(dataOf)
    .map((d) => d as unknown as DmMessageRecord)
    .sort((a, b) => (a.message_id < b.message_id ? -1 : 1));
}

export interface DmThreadView extends DmThreadRecord {
  last_message_at: string;
  message_count: number;
}

// projectDmThreadsForActor — actor が参加者に含まれる thread 一覧を lastMessageAt 降順で
// 返す(バブル一覧のソート順・都度再計算・常駐 index 無し)。
export async function projectDmThreadsForActor(s: TruthStore, actorId: string): Promise<DmThreadView[]> {
  const threads = (await listDmThreads(s)).filter((t) => t.participants.includes(actorId));
  const views = await Promise.all(
    threads.map(async (t) => {
      const messages = await listDmMessages(s, t.thread_id);
      const lastMessageAt = messages.length ? messages[messages.length - 1].created_at : t.created_at;
      return { ...t, last_message_at: lastMessageAt, message_count: messages.length };
    }),
  );
  return views.sort((a, b) => (a.last_message_at < b.last_message_at ? 1 : -1));
}

// POST /plaza/dm/threads { participants: string[], context_type? } — DM スレ作成。
// 呼び出し actor は participants に自動で加える(呼び忘れ防止)。
plazaDmRoutes.post("/plaza/dm/threads", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const actorId = c.get("actorId");
  const raw = Array.isArray(body?.participants) ? (body!.participants as unknown[]).filter((p) => typeof p === "string") as string[] : [];
  const participants = [...new Set([actorId, ...raw])];
  if (participants.length < 2) return c.json({ error: "INVALID_THREAD", details: ["at least one other participant required"] }, 400);

  const contextType = (
    ["trade", "international_trade", "appeal", "research", "market", "general"].includes(str(body?.context_type))
      ? str(body?.context_type)
      : "general"
  ) as DmThreadRecord["context_type"];

  const threadId = str(body?.thread_id) || ulid();
  const s = store(c);
  const data: Record<string, unknown> = {
    thread_id: threadId,
    participants,
    context_type: contextType,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  const key = `truth/${DM_THREAD_TYPE}/${threadId}.json`;
  const res = await s.putEventAt(key, envelope(DM_THREAD_TYPE, DM_THREAD_SCHEMA, threadId, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_THREAD", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_THREAD", key: res.key }, 409);
  return c.json({ thread_id: threadId, participants, context_type: contextType }, 201);
});

// GET /plaza/dm/threads — 自分が参加するスレ一覧(lastMessageAt 降順)。
plazaDmRoutes.get("/plaza/dm/threads", async (c) => {
  const actorId = c.get("actorId");
  return c.json({ threads: await projectDmThreadsForActor(store(c), actorId) });
});

// GET /plaza/dm/threads/:thread_id/messages — バブル表示用メッセージ一覧(参加者のみ)。
plazaDmRoutes.get("/plaza/dm/threads/:thread_id/messages", async (c) => {
  const threadId = c.req.param("thread_id");
  const s = store(c);
  const thread = (await listDmThreads(s)).find((t) => t.thread_id === threadId);
  if (!thread) return c.json({ error: "NOT_FOUND" }, 404);
  const actorId = c.get("actorId");
  if (!thread.participants.includes(actorId)) return c.json({ error: "FORBIDDEN" }, 403);
  return c.json({ thread_id: threadId, messages: await listDmMessages(s, threadId) });
});

// POST /plaza/dm/threads/:thread_id/messages { body } — 送信(参加者のみ)。
plazaDmRoutes.post("/plaza/dm/threads/:thread_id/messages", async (c) => {
  const threadId = c.req.param("thread_id");
  const s = store(c);
  const thread = (await listDmThreads(s)).find((t) => t.thread_id === threadId);
  if (!thread) return c.json({ error: "NOT_FOUND" }, 404);
  const actorId = c.get("actorId");
  if (!thread.participants.includes(actorId)) return c.json({ error: "FORBIDDEN" }, 403);

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const text = str(body?.body);
  if (!text.trim()) return c.json({ error: "INVALID_MESSAGE", details: ["body required"] }, 400);

  const messageId = ulid();
  const data: Record<string, unknown> = {
    message_id: messageId,
    thread_id: threadId,
    actor_id: actorId,
    body: text,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  const key = `truth/${DM_MESSAGE_TYPE}/${threadId}/${messageId}.json`;
  const res = await s.putEventAt(key, envelope(DM_MESSAGE_TYPE, DM_MESSAGE_SCHEMA, messageId, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_MESSAGE", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_MESSAGE", key: res.key }, 409);
  return c.json({ message_id: messageId, thread_id: threadId }, 201);
});
