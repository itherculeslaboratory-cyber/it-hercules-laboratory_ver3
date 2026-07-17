// V3-MKT-03 取引ステージモデルの Stage0/1(マッチング前)公開面: 「商品詳細+公開Q&A+
// ほめボードのみ」。既存の状態機械(market-routes.ts/market-settlement.ts)は非公開
// ボード(Stage2・matched 以降・当事者2人のみ)を実装済みで、公開面は listing 詳細
// (title/description/price)しか無かった — 本ファイルが「公開Q&A」+「ほめボード」を
// 追加する(ihl.mkt.comment.v1・append-only)。kind=question/praise は誰でも投稿可、
// kind=answer は出品者のみ(route ガード。マッチング後の当事者限定ボードとは別物=
// 誰でも読める公開欄のまま)。全 route PROTECTED・actor_id はセッション principal 強制
// (V3-AUT-17)。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { reduceMarket, type TxnEvent } from "./market-settlement";

const TXN_TYPE = "ihl.mkt.transaction_event.v1";
const COMMENT_TYPE = "ihl.mkt.comment.v1";
const COMMENT_SCHEMA = "schemas/events/mkt-comment.schema.json";
const SCHEMA_VERSION = "1";

export const marketCommentRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

function envelope(id: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: COMMENT_TYPE,
    time: new Date().toISOString(),
    dataschema: COMMENT_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}

async function listComments(s: TruthStore, listingId: string): Promise<Record<string, unknown>[]> {
  return (await s.listEvents(`truth/${COMMENT_TYPE}/${listingId}/`)).map(dataOf);
}

// listing の出品者を状態機械の投影から得る(market-routes.ts loadTxns と同型・ihl.mkt.listing.v1
// 単体の存在を前提にしない=既存 TC の慣例(transition だけで listing を扱う)に合わせる)。
async function sellerOf(s: TruthStore, listingId: string): Promise<string | undefined> {
  const all = (await s.listEvents(`truth/${TXN_TYPE}/`)).map(dataOf) as unknown as TxnEvent[];
  const mine = all.filter((d) => d.listing_id === listingId);
  return reduceMarket(listingId, mine).seller_id;
}

// POST /market/listings/{id}/comments — 公開Q&A(question)/ほめボード(praise)投稿、
// 出品者の回答(answer・parent_comment_id必須・対象は同一listingの question のみ)。
marketCommentRoutes.post("/market/listings/:listing_id/comments", async (c) => {
  const listingId = c.req.param("listing_id");
  const s = store(c);

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const kind = body?.kind === "answer" || body?.kind === "praise" ? body.kind : "question";
  const commentBody = typeof body?.body === "string" ? body.body.trim() : "";
  if (!commentBody) return c.json({ error: "INVALID_COMMENT", details: ["body required"] }, 400);

  const actorId = c.get("actorId");
  const data: Record<string, unknown> = {
    comment_id: ulid(),
    listing_id: listingId,
    actor_id: actorId,
    kind,
    body: commentBody,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };

  if (kind === "answer") {
    const sellerId = await sellerOf(s, listingId);
    if (sellerId !== actorId) {
      return c.json({ error: "FORBIDDEN", details: ["only the seller may answer"] }, 403);
    }
    const parentId = typeof body?.parent_comment_id === "string" ? body.parent_comment_id : "";
    if (!parentId) return c.json({ error: "INVALID_COMMENT", details: ["parent_comment_id required for answer"] }, 400);
    const existing = await listComments(s, listingId);
    const question = existing.find((x) => x.comment_id === parentId && x.kind === "question");
    if (!question) return c.json({ error: "INVALID_COMMENT", details: ["parent_comment_id must reference a question on this listing"] }, 400);
    data.parent_comment_id = parentId;
  }

  const id = data.comment_id as string;
  const res = await s.putEventAt(`truth/${COMMENT_TYPE}/${listingId}/${id}.json`, envelope(id, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_COMMENT", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_COMMENT", key: res.key }, 409);
  return c.json({ comment_id: id, listing_id: listingId, kind }, 201);
});

// GET /market/listings/{id}/comments — 公開Q&A+ほめボード一覧(マッチング前後を問わず
// 常時公開・stage を絞らない=商品詳細と同じ公開面)。
marketCommentRoutes.get("/market/listings/:listing_id/comments", async (c) => {
  const listingId = c.req.param("listing_id");
  const comments = await listComments(store(c), listingId);
  comments.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return c.json({
    listing_id: listingId,
    questions: comments.filter((x) => x.kind === "question" || x.kind === "answer"),
    praise: comments.filter((x) => x.kind === "praise"),
  });
});
