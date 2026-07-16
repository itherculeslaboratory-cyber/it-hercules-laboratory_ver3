// V3-MKT-61: ブロックしたユーザーとは金銭・成体・標本の取引が一切できない
// (オファー・購入確定・予約マッチング・入札含む)。掲示板/議論は不干渉(本モジュールが
// 触るのは市場 route のみ・plaza/gov には配線しない)。既存の投稿向けブロックリスト
// (V3-AUT-28)とは別の専用イベント ihl.mkt.block.v1 を持つ(round-15 裁定 #5: 既存
// リストは「取引不可」を明記していないため新規)。ブロックは (blocker,blocked) ペア
// 単位の append-only last-write-wins 投影(pref-set と同型・UPDATE/DELETE 不使用=
// 不変条項③)で unblock を表現する。全 route PROTECTED・actor_id はセッション
// principal 強制刻印(V3-AUT-17)。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";

const BLOCK_TYPE = "ihl.mkt.block.v1";
const BLOCK_SCHEMA = "schemas/events/mkt-block.schema.json";
const SCHEMA_VERSION = "1";

export const marketBlockRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

interface BlockEvent {
  block_id: string;
  actor_id: string;
  blocked_actor_id: string;
  action: "block" | "unblock";
  created_at: string;
}

// ponytail: block-type 全走査 O(n)。MVP 量なら十分。投影 index は別波(design-c2 §3.1)。
async function listBlockEvents(s: TruthStore): Promise<BlockEvent[]> {
  return (await s.listEvents(`truth/${BLOCK_TYPE}/`)).map(dataOf) as unknown as BlockEvent[];
}

/** (blocker,blocked) ペア単位で最新 action を LWW 投影(pref-set と同型)。 */
function latestActionFor(events: BlockEvent[], blocker: string, blocked: string): "block" | "unblock" | null {
  const pair = events
    .filter((e) => e.actor_id === blocker && e.blocked_actor_id === blocked)
    .sort((a, b) => (a.created_at === b.created_at ? a.block_id.localeCompare(b.block_id) : a.created_at < b.created_at ? -1 : 1));
  const last = pair[pair.length - 1];
  return last ? last.action : null;
}

/** V3-MKT-61: a・b いずれか一方でも相手をブロックしていれば取引不可(片方向ブロックで
 * 双方向に遮断=安全側)。市場 route の取引ガードから呼ぶ。 */
export async function isBlockedPair(s: TruthStore, a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  const events = await listBlockEvents(s);
  return latestActionFor(events, a, b) === "block" || latestActionFor(events, b, a) === "block";
}

/** 本人が現在ブロックしている相手の一覧(action=block が最新のペアのみ)。 */
export async function listMyBlocks(s: TruthStore, actorId: string): Promise<string[]> {
  const events = await listBlockEvents(s);
  const targets = new Set(events.filter((e) => e.actor_id === actorId).map((e) => e.blocked_actor_id));
  return [...targets].filter((t) => latestActionFor(events, actorId, t) === "block").sort();
}

// POST /market/blocks — ブロック追加/解除(action 省略時は "block")。自分自身は不可。
marketBlockRoutes.post("/market/blocks", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const blockedActorId = body && typeof body.blocked_actor_id === "string" ? body.blocked_actor_id.trim() : "";
  if (!blockedActorId) return c.json({ error: "INVALID_BLOCK", details: ["blocked_actor_id required"] }, 400);

  const actorId = c.get("actorId");
  if (blockedActorId === actorId) return c.json({ error: "CANNOT_BLOCK_SELF" }, 400);

  const action = body?.action === "unblock" ? "unblock" : "block";
  const id = ulid();
  const data: Record<string, unknown> = {
    block_id: id,
    actor_id: actorId,
    blocked_actor_id: blockedActorId,
    action,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  const res = await store(c).putEvent({
    specversion: "1.0",
    id,
    source: "apps/api",
    type: BLOCK_TYPE,
    time: new Date().toISOString(),
    dataschema: BLOCK_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  });
  if (res.status === "invalid") return c.json({ error: "INVALID_BLOCK", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_BLOCK", key: res.key }, 409);
  return c.json({ block_id: id, blocked_actor_id: blockedActorId, action }, 201);
});

// GET /market/blocks — 本人が現在ブロックしている相手の一覧。
marketBlockRoutes.get("/market/blocks", async (c) => {
  const actorId = c.get("actorId");
  return c.json({ blocked_actor_ids: await listMyBlocks(store(c), actorId) });
});
