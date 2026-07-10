// マーケット骨格(design-c4 §3 / V3-MKT-01 — 出品/閲覧まで)。出品イベント
// ihl.mkt.listing.v1 を Truth append、一覧/詳細は投影で都度再計算(常駐 DB 禁止・
// 不変条項①)。全 route PROTECTED(index.ts §1.5 が gate・actorId を set)。書込は
// data.actor_id をセッション principal で強制刻印(V3-AUT-17)。取引遷移(match/
// transition)・決済連動は C4 対象外(matrix ver3_note)。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";

const LISTING_TYPE = "ihl.mkt.listing.v1";
const LISTING_SCHEMA = "schemas/events/mkt-listing.schema.json";
const SCHEMA_VERSION = 1;

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
