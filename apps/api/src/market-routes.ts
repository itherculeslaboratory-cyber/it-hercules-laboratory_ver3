// マーケット骨格(design-c4 §3 / V3-MKT-01 — 出品/閲覧まで)。出品イベント
// ihl.mkt.listing.v1 を Truth append、一覧/詳細は投影で都度再計算(常駐 DB 禁止・
// 不変条項①)。全 route PROTECTED(index.ts §1.5 が gate・actorId を set)。書込は
// data.actor_id をセッション principal で強制刻印(V3-AUT-17)。取引遷移(match/
// transition)・決済連動は C4 対象外(matrix ver3_note)。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import {
  reduceMarket,
  projectSettlement,
  projectOwnershipLineage,
  isAllowedEdge,
  type MarketKind,
  type MarketState,
  type TxnEvent,
} from "./market-settlement";

const LISTING_TYPE = "ihl.mkt.listing.v1";
const LISTING_SCHEMA = "schemas/events/mkt-listing.schema.json";
const SCHEMA_VERSION = 1;

// 取引状態機械イベント(design-k3 §2.1)。schema_version は string。
const TXN_TYPE = "ihl.mkt.transaction_event.v1";
const TXN_SCHEMA = "schemas/events/mkt-transaction-event.schema.json";
const TXN_SCHEMA_VERSION = "1";

// /transition が受ける遷移 kind(offer/love_letter は POST /market/offers 専用・
// tax_* 等の経済副次 kind は本 route では発行しない)。
const TRANSITION_KINDS = new Set<MarketKind>([
  "list_fixed", "list_auction", "list_lottery", "list_platinum",
  "bid", "match", "ship", "receive", "rate", "delist", "transfer",
]);

export const marketRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

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
    type: LISTING_TYPE,
    time: new Date().toISOString(),
    dataschema: LISTING_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}

// POST /market/listings — 出品を append(201/400/409)。title は必須。listing_id は
// client 任意 ULID(冪等キー → 二重で 409)・省略時生成。actor_id は常にセッション
// principal(V3-AUT-17)。price は任意の非負整数のみ採用。
marketRoutes.post("/market/listings", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const title = body && typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return c.json({ error: "INVALID_LISTING", details: ["title required"] }, 400);

  const actorId = c.get("actorId");
  const listingId = typeof body?.listing_id === "string" && body.listing_id ? body.listing_id : ulid();

  const data: Record<string, unknown> = {
    listing_id: listingId,
    actor_id: actorId,
    title,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (typeof body?.description === "string") data.description = body.description;
  const price = Number(body?.price);
  if (Number.isInteger(price) && price >= 0) data.price = price;

  const res = await store(c).putEvent(envelope(listingId, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_LISTING", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_LISTING", key: res.key }, 409);
  return c.json({ listing_id: listingId }, 201);
});

// GET /market/listings — 一覧投影(全出品)。
// ponytail: listing-type prefix scan = O(n) 全走査。MVP 量なら十分。投影 index は
// 別波(design-c2 §3.1「一覧系投影は R2 prefix scan」)。
marketRoutes.get("/market/listings", async (c) => {
  const listings = (await store(c).listEvents(`truth/${LISTING_TYPE}/`)).map(dataOf);
  return c.json({ listings });
});

// GET /market/listings/{listing_id} — 詳細投影(404 or { listing })。
marketRoutes.get("/market/listings/:listing_id", async (c) => {
  const listingId = c.req.param("listing_id");
  const ev = await store(c).readEvent(`truth/${LISTING_TYPE}/${listingId}.json`);
  if (!ev) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json({ listing: dataOf(ev) });
});

// ── 取引状態機械(MKT-01/02/03/06/29)────────────────────────────────────
// ponytail: 取引型を prefix scan + listing フィルタ = O(n) 全走査(既存 listing 投影
// と同型・投影 index は別波)。非エスクロー=資金は一切預らない(MKT-01)。
async function loadTxns(c: { env: Bindings }, listingId: string): Promise<TxnEvent[]> {
  const all = (await store(c).listEvents(`truth/${TXN_TYPE}/`)).map(dataOf) as unknown as TxnEvent[];
  return all.filter((d) => d.listing_id === listingId);
}

function txnEnvelope(id: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: TXN_TYPE,
    time: new Date().toISOString(),
    dataschema: TXN_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}

// 取引イベントを append(actor_id はセッション principal 強制・V3-AUT-17)。data と
// putEvent 結果を返す(投影の即時再計算に data を使う)。
async function appendTxn(
  c: { env: Bindings },
  listingId: string,
  actorId: string,
  kind: MarketKind,
  extra: Record<string, unknown>,
) {
  const id = ulid();
  const data: Record<string, unknown> = {
    transaction_event_id: id,
    listing_id: listingId,
    actor_id: actorId,
    kind,
    ...extra,
    created_at: new Date().toISOString(),
    schema_version: TXN_SCHEMA_VERSION,
  };
  const res = await store(c).putEvent(txnEnvelope(id, actorId, data));
  return { res, data: data as unknown as TxnEvent };
}

// 当事者ガード: 出品者/落札者のみが自分側のアクションを起こせる(第三者による
// 横取り match / 他人の受取申告を禁ずる)。当事者未確定(seller/buyer 不在)なら素通し。
function transitionActorGuard(kind: MarketKind, cur: MarketState, actorId: string): string | null {
  const sellerOnly = kind === "match" || kind === "ship" || kind === "delist" || kind === "transfer";
  const buyerOnly = kind === "receive" || kind === "rate";
  if (sellerOnly && cur.seller_id && actorId !== cur.seller_id) return "seller only";
  if (buyerOnly && cur.matched_with && actorId !== cur.matched_with) return "matched buyer only";
  if (kind === "bid" && cur.seller_id === actorId) return "seller cannot bid own listing";
  return null;
}

function pickExtra(body: Record<string, unknown> | null): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  if (body && typeof body.counterparty === "string") extra.counterparty = body.counterparty;
  if (body && Number.isFinite(Number(body.amount))) extra.amount = Number(body.amount);
  if (body && Array.isArray(body.individual_ids)) extra.individual_ids = body.individual_ids;
  if (body && body.payload && typeof body.payload === "object") extra.payload = body.payload;
  return extra;
}

// POST /market/listings/{id}/transition — 許可辺のみ(不正遷移は 409・MKT-02)。
// 最初の遷移は unlisted→list_* のみ許可(=各チャネルの出品ルール・MKT-01)。
marketRoutes.post("/market/listings/:listing_id/transition", async (c) => {
  const listingId = c.req.param("listing_id");
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const kind = body?.kind as MarketKind | undefined;
  if (!kind || !TRANSITION_KINDS.has(kind)) {
    return c.json({ error: "INVALID_TRANSITION", details: ["unknown or unsupported kind"] }, 400);
  }
  const actorId = c.get("actorId");
  const events = await loadTxns(c, listingId);
  const cur = reduceMarket(listingId, events);
  if (!isAllowedEdge(cur.state, kind)) {
    return c.json({ error: "ILLEGAL_TRANSITION", from: cur.state, kind }, 409);
  }
  const guard = transitionActorGuard(kind, cur, actorId);
  if (guard) return c.json({ error: "FORBIDDEN", details: [guard] }, 403);

  const extra = pickExtra(body);
  if ((kind === "match" || kind === "transfer") && typeof extra.counterparty !== "string") {
    return c.json({ error: "INVALID_TRANSITION", details: ["counterparty required"] }, 400);
  }
  const { res, data } = await appendTxn(c, listingId, actorId, kind, extra);
  if (res.status === "invalid") return c.json({ error: "INVALID_TRANSITION", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_TRANSITION", key: res.key }, 409);

  const next = reduceMarket(listingId, [...events, data]);
  return c.json({ listing_id: listingId, state: next.state, stage: next.stage }, 201);
});

// GET /market/listings/{id}/state — 末尾状態 + stage + 成立投影(MKT-02/03)。
marketRoutes.get("/market/listings/:listing_id/state", async (c) => {
  const listingId = c.req.param("listing_id");
  const events = await loadTxns(c, listingId);
  const cur = reduceMarket(listingId, events);
  return c.json({ ...cur, settlement: projectSettlement(events, new Date()) });
});

// GET /market/listings/{id}/board — 非公開ボード(matched 以降・当事者2人のみ・
// 第三者 403・MKT-03)。出品者向けに offer/love_letter を集約(値段は love_letter
// のみ非開示・MKT-06)。
marketRoutes.get("/market/listings/:listing_id/board", async (c) => {
  const listingId = c.req.param("listing_id");
  const actorId = c.get("actorId");
  const events = await loadTxns(c, listingId);
  const cur = reduceMarket(listingId, events);
  if (cur.stage < 2) return c.json({ error: "BOARD_NOT_OPEN" }, 404);
  const parties = [cur.seller_id, cur.matched_with].filter((x): x is string => !!x);
  if (!parties.includes(actorId)) return c.json({ error: "FORBIDDEN" }, 403);
  const offers = events
    .filter((e) => e.kind === "offer" || e.kind === "love_letter")
    .map((e) => ({
      from: e.actor_id,
      kind: e.kind,
      amount: e.kind === "love_letter" ? undefined : e.amount, // ラブレターは値段非開示
      at: e.created_at,
    }));
  return c.json({ listing_id: listingId, stage: cur.stage, state: cur.state, parties, matched_with: cur.matched_with, offers });
});

// GET /market/listings/{id}/ownership — 所有権系譜(観測引継ぎ・MKT-29)。
marketRoutes.get("/market/listings/:listing_id/ownership", async (c) => {
  const listingId = c.req.param("listing_id");
  const events = await loadTxns(c, listingId);
  return c.json(projectOwnershipLineage(events));
});

// POST /market/offers — 直接オファー / ラブレター(MKT-06)。自分の出品には出せない
// (403)。オファーを受けないチャネル(auction/lottery/platinum)や締切済みは非許可辺
// で 409(拒否ポリシー)。値段は応答に載せない(非開示集約)。
marketRoutes.post("/market/offers", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const listingId = body && typeof body.listing_id === "string" ? body.listing_id : "";
  if (!listingId) return c.json({ error: "INVALID_OFFER", details: ["listing_id required"] }, 400);
  const kind: MarketKind = body?.love_letter === true ? "love_letter" : "offer";
  const actorId = c.get("actorId");
  const events = await loadTxns(c, listingId);
  const cur = reduceMarket(listingId, events);
  if (cur.seller_id === actorId) return c.json({ error: "FORBIDDEN", details: ["cannot offer on own listing"] }, 403);
  if (!isAllowedEdge(cur.state, kind)) return c.json({ error: "OFFER_REJECTED", from: cur.state }, 409);

  const extra: Record<string, unknown> = {};
  if (cur.seller_id) extra.counterparty = cur.seller_id;
  if (Number.isFinite(Number(body?.amount))) extra.amount = Number(body?.amount);
  const { res, data } = await appendTxn(c, listingId, actorId, kind, extra);
  if (res.status === "invalid") return c.json({ error: "INVALID_OFFER", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_OFFER", key: res.key }, 409);
  return c.json({ listing_id: listingId, transaction_event_id: data.transaction_event_id, kind }, 201);
});
