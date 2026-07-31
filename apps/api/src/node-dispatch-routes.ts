// GET /node/:node_id — 統一ノードビュー(design35 §3 A-5・697-706行)。新しい保存場所は作らない。
// id 接頭辞ではなく型ごとの Truth キー構造で content/ppr-cycle-node/plaza-post のどれかへ振り分ける。
// index.ts は全艦不可侵のため本ファイルは未マウント(bridge2の書いてよい場所規約と同じ扱い=
// FND-22 middlewareパターンを踏襲。mount行は報告書に明記しHQが適用)。
//
// ★性能の正直な注記(design35原文どおり): content と ppr-cycle-node は id 自体が Truth キーの
// 全体(<id>.json)なので readEvent 1発=O(1)。plaza-post は Truth キーが
// truth/ihl.plaza.post.v1/<channel>/<thread_id>/<post_id>.json と channel/thread_id を含む
// 階層になっており、post_id だけからは exact key を組み立てられない。よって plaza-post 候補は
// listEvents(prefix) の全件走査でしか探せない(「indexがあるかのように書くな」に従い、この
// 順序=content/ppr-cycle-node を先に安価に試し、最後に高価な plaza-post 全件走査へ落とす)。
import { Hono } from "hono";
import { TruthStore } from "@ihl/truth";
import type { Bindings, Variables } from "./env";

const CONTENT_TYPE = "ihl.research.content.v1";
const PPR_CYCLE_NODE_TYPE = "ihl.ppr.cycle_node.v1";
const PLAZA_POST_TYPE = "ihl.plaza.post.v1";

function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

export type DispatchedNode =
  | { node_kind: "content"; node: Record<string, unknown> }
  | { node_kind: "ppr-cycle-node"; node: Record<string, unknown> }
  | { node_kind: "plaza-post"; node: Record<string, unknown> }
  | null;

/**
 * 統一ノードビューの解決本体(純粋にTruthStoreを引数に取る・route薄層から分離してテスト容易化)。
 * O(1)候補(content/ppr-cycle-node)を先に試し、どちらでもなければ plaza-post を全件走査する。
 */
export async function dispatchNode(s: TruthStore, nodeId: string): Promise<DispatchedNode> {
  const contentEv = await s.readEvent(`truth/${CONTENT_TYPE}/${nodeId}.json`);
  if (contentEv) return { node_kind: "content", node: dataOf(contentEv) };

  const cycleNodeEv = await s.readEvent(`truth/${PPR_CYCLE_NODE_TYPE}/${nodeId}.json`);
  if (cycleNodeEv) return { node_kind: "ppr-cycle-node", node: dataOf(cycleNodeEv) };

  // 高価な経路: post_id だけでは channel/thread_id を含む exact key を組み立てられないため、
  // plaza-post 全件を prefix scan して post_id 一致行を探す(O(n)・専用 index は別波)。
  const posts = (await s.listEvents(`truth/${PLAZA_POST_TYPE}/`)).map(dataOf);
  const post = posts.find((d) => d.post_id === nodeId);
  if (post) return { node_kind: "plaza-post", node: post };

  return null;
}

export const nodeRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}

nodeRoutes.get("/node/:node_id", async (c) => {
  const nodeId = c.req.param("node_id");
  const result = await dispatchNode(store(c), nodeId);
  if (!result) return c.json({ error: "NODE_NOT_FOUND" }, 404);
  return c.json(result, 200);
});
