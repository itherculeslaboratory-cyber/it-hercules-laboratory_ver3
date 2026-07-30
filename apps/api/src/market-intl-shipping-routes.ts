// V3-MKT-21(w2-mkt): 国際配送・通関は『送り国×受け国』の2次元構造(from×to)で
// R2 JSON(料金表・by_pair の通関ノート・HS コード等)に保存し、国内/海外→海外も
// 同一構造で扱う。append-only last-write-wins 投影(market-block-routes.ts の
// (blocker,blocked) ペア投影・settings-routes.ts の pref-set と同型パターン=
// UPDATE/DELETE 不使用・不変条項③)。海外発送は標本(乾燥個体)のみ許可し生体の
// 国際輸送は禁止(POST /market/listings/{id}/intl 側で specimen_dried を要求)。
// 全画面で「本体価格+推定送料=総額」を出す GET /market/listings/{id}/total-price
// を提供する(人気ランキングは国際マーケットに入れない=本モジュールはランキングを
// 一切持たない)。
//
// [判断: 出品スキーマを拡張しない理由] ships_from/specimen_dried を既存の
// ihl.mkt.listing.v1(schemas/events/mkt-listing.schema.json, additionalProperties:
// false)へ直接足すと、precompile 済み validator(packages/truth/src/generated/
// validators.cjs・全ドメイン共通の生成物・codegen 再実行が要る)まで更新しないと
// 400 で弾かれ続ける。generated/ の再生成は本艦の glob 外(w2-mkt は apps/api/src
// の market*/shop-routes/... のみ)かつ全ドメイン共通のため、ここでは listing 本体
// を拡張せず、未登録の追加イベント型(ihl.mkt.listing_intl.v1)を別途 append する
// 設計にした(このイベント型は VALIDATOR_NAME/EVENT_NAMES に未登録のため
// envelope.ts の eventSchemaFor が null を返し検証対象外=schemas/events 側に
// 新規スキーマファイルを置いても置かなくても機能は同じ。将来 codegen が回った波で
// mkt-listing.schema.json 側へ正式に統合してよい)。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { projectPreferences } from "./settings-routes";

const RATE_TYPE = "ihl.mkt.intl_shipping_rate.v1";
const RATE_SCHEMA = "schemas/events/mkt-intl-shipping-rate.schema.json";
const SCHEMA_VERSION = "1";
const LISTING_TYPE = "ihl.mkt.listing.v1";
const LISTING_INTL_TYPE = "ihl.mkt.listing_intl.v1";
const LISTING_INTL_SCHEMA = "schemas/events/mkt-listing-intl.schema.json";

export const marketIntlShippingRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

interface RateEvent {
  rate_id: string;
  actor_id: string;
  from: string;
  to: string;
  price_yen: number;
  customs_note?: string;
  hs_code?: string;
  created_at: string;
}

function pairKey(from: string, to: string): string {
  return `${from.trim().toLowerCase()}__${to.trim().toLowerCase()}`;
}

function rateEnvelope(id: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: RATE_TYPE,
    time: new Date().toISOString(),
    dataschema: RATE_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}

/** by_pair の最新1件(last-write-wins)。ponytail: pair 単位 prefix-scan O(n)(既存
 * market-block-routes.ts と同型・投影 index は別波)。 */
export async function projectShippingRate(
  s: TruthStore,
  from: string,
  to: string,
): Promise<{ price_yen: number; customs_note?: string; hs_code?: string } | null> {
  const key = pairKey(from, to);
  const all = (await s.listEvents(`truth/${RATE_TYPE}/${key}-`)).map(dataOf) as unknown as RateEvent[];
  if (all.length === 0) return null;
  const last = [...all].sort((a, b) => (a.created_at < b.created_at ? -1 : 1))[all.length - 1];
  return { price_yen: last.price_yen, customs_note: last.customs_note, hs_code: last.hs_code };
}

// POST /market/intl-shipping/rates — from×to の料金表更新(誰でも追記可・R2 JSON
// append-only。GUI 管理者限定は将来波・本波は「同一構造で保存できる」ことが完了条件)。
marketIntlShippingRoutes.post("/market/intl-shipping/rates", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const from = typeof body?.from === "string" ? body.from.trim() : "";
  const to = typeof body?.to === "string" ? body.to.trim() : "";
  const priceYen = Number(body?.price_yen);
  if (!from || !to || !Number.isInteger(priceYen) || priceYen < 0) {
    return c.json({ error: "INVALID_RATE", details: ["from, to, price_yen(non-negative integer) required"] }, 400);
  }
  const actorId = c.get("actorId");
  const id = ulid();
  const data: Record<string, unknown> = {
    rate_id: id,
    actor_id: actorId,
    from,
    to,
    price_yen: priceYen,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (typeof body?.customs_note === "string") data.customs_note = body.customs_note;
  if (typeof body?.hs_code === "string") data.hs_code = body.hs_code;
  const key = `truth/${RATE_TYPE}/${pairKey(from, to)}-${id}.json`;
  const res = await store(c).putEventAt(key, rateEnvelope(id, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_RATE", details: res.errors }, 400);
  return c.json({ rate_id: id }, 201);
});

// GET /market/intl-shipping/rates?from=..&to=.. — 現行料金の参照。
marketIntlShippingRoutes.get("/market/intl-shipping/rates", async (c) => {
  const from = c.req.query("from") ?? "";
  const to = c.req.query("to") ?? "";
  if (!from || !to) return c.json({ error: "INVALID_QUERY", details: ["from and to required"] }, 400);
  const rate = await projectShippingRate(store(c), from, to);
  if (!rate) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json({ from, to, ...rate });
});

// POST /market/listings/{id}/intl — 出品者が送り国+標本(乾燥個体)確認を宣言する
// (出品者本人のみ・冪等キーで1出品=1回)。生体(specimen_dried!==true)の国際発送は
// 400(INTL_LIVE_FORBIDDEN・生体の国際輸送は禁止)。
marketIntlShippingRoutes.post("/market/listings/:listing_id/intl", async (c) => {
  const listingId = c.req.param("listing_id");
  const s = store(c);
  const listingEv = await s.readEvent(`truth/${LISTING_TYPE}/${listingId}.json`);
  if (!listingEv) return c.json({ error: "NOT_FOUND" }, 404);
  const listing = dataOf(listingEv);
  const actorId = c.get("actorId");
  if (listing.actor_id !== actorId) return c.json({ error: "FORBIDDEN", details: ["seller only"] }, 403);

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const shipsFrom = typeof body?.ships_from === "string" ? body.ships_from.trim() : "";
  if (!shipsFrom) return c.json({ error: "INVALID_INTL", details: ["ships_from required"] }, 400);
  if (body?.specimen_dried !== true) {
    return c.json({ error: "INTL_LIVE_FORBIDDEN", details: ["international shipping requires specimen_dried=true"] }, 400);
  }

  const id = ulid();
  const data: Record<string, unknown> = {
    listing_intl_id: id,
    listing_id: listingId,
    actor_id: actorId,
    ships_from: shipsFrom,
    specimen_dried: true,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  const res = await s.putEventAt(`truth/${LISTING_INTL_TYPE}/${listingId}.json`, {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: LISTING_INTL_TYPE,
    time: new Date().toISOString(),
    dataschema: LISTING_INTL_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  });
  if (res.status === "conflict") return c.json({ error: "ALREADY_DECLARED" }, 409);
  return c.json({ listing_id: listingId, ships_from: shipsFrom }, 201);
});

async function projectListingIntl(s: TruthStore, listingId: string): Promise<{ ships_from: string } | null> {
  const ev = await s.readEvent(`truth/${LISTING_INTL_TYPE}/${listingId}.json`);
  if (!ev) return null;
  const d = dataOf(ev);
  return typeof d.ships_from === "string" ? { ships_from: d.ships_from } : null;
}

// GET /market/listings/{id}/total-price — 本体価格+推定送料=総額(全画面共通の
// 比較・並べ替え表示元)。買い手の国は settings-routes の pref(country)から読む
// (未設定=国内相当として送料0扱い・断定しない)。出品の送り国は listing_intl(POST
// /market/listings/{id}/intl で宣言済みのときだけ存在)。
marketIntlShippingRoutes.get("/market/listings/:listing_id/total-price", async (c) => {
  const listingId = c.req.param("listing_id");
  const s = store(c);
  const listingEv = await s.readEvent(`truth/${LISTING_TYPE}/${listingId}.json`);
  if (!listingEv) return c.json({ error: "NOT_FOUND" }, 404);
  const listing = dataOf(listingEv);
  const price = typeof listing.price === "number" ? listing.price : 0;
  const intl = await projectListingIntl(s, listingId);
  const shipsFrom = intl?.ships_from ?? "";
  const actorId = c.get("actorId");
  const buyerCountry = (await projectPreferences(s, actorId)).country || shipsFrom;

  if (!shipsFrom || !buyerCountry || shipsFrom.toLowerCase() === buyerCountry.toLowerCase()) {
    return c.json({ listing_id: listingId, price, estimated_shipping_yen: 0, total_price: price, international: false });
  }
  const rate = await projectShippingRate(s, shipsFrom, buyerCountry);
  const shipping = rate?.price_yen ?? 0;
  return c.json({
    listing_id: listingId,
    price,
    estimated_shipping_yen: shipping,
    total_price: price + shipping,
    international: true,
    customs_note: rate?.customs_note,
  });
});
