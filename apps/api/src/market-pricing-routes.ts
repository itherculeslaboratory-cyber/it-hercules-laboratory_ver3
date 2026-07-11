// MKT-23/25/20 出品支援(黄金フロー autofill・推奨価格・送料見積り)。全て純関数 +
// 薄い route。推奨価格は類似個体の過去成約価格を重み付き平均/中央値で集約し計算元を
// 全公開、embedding は既定 OFF(明示 ON 時のみ・不変条項①)。送料は観測から梱包サイズを
// 推定し局間距離×サイズ、着払い前提で住所は一切保持しない(PII 不使用・MKT-20)。
// 全 route PROTECTED・actor_id はセッション principal 強制(V3-AUT-17)。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";

const POST_OFFICE_TYPE = "ihl.mkt.post_office.v1";
const POST_OFFICE_SCHEMA = "schemas/events/mkt-post-office.schema.json";
const TXN_TYPE = "ihl.mkt.transaction_event.v1";
const SCHEMA_VERSION = "1";

export const marketPricingRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

// ── MKT-25 推奨価格(embedding 既定 OFF)──────────────────────────────────
export interface Comparable {
  individual_id: string;
  price: number;
  weight?: number; // 類似度重み(既定 1)。whitelist/subset 特徴の一致度で与える。
}
export interface PriceRecommendation {
  anchor: number; // 推奨価格(円・整数)
  method: "weighted_mean" | "median";
  sources: { individual_id: string; price: number; weight: number }[]; // 計算元全公開
  embedding_used: boolean; // 既定 false(不変条項①)
}

/** 類似個体の過去成約価格を集約(重み付き平均 or 中央値)。計算元を sources に全公開。
 *  embedding は opts.embedding===true のときだけ used=true(既定 OFF・MKT-25)。 */
export function recommendPrice(
  comparables: Comparable[],
  opts: { method?: "weighted_mean" | "median"; embedding?: boolean } = {},
): PriceRecommendation {
  const method = opts.method === "median" ? "median" : "weighted_mean";
  const sources = comparables.map((c) => ({
    individual_id: c.individual_id,
    price: c.price,
    weight: c.weight ?? 1,
  }));
  let anchor = 0;
  if (sources.length > 0) {
    if (method === "median") {
      const sorted = [...sources].map((s) => s.price).sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      anchor = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    } else {
      const wsum = sources.reduce((a, s) => a + s.weight, 0);
      anchor = wsum > 0 ? sources.reduce((a, s) => a + s.price * s.weight, 0) / wsum : 0;
    }
  }
  return {
    anchor: Math.round(anchor),
    method,
    sources,
    embedding_used: opts.embedding === true,
  };
}

// ── MKT-23 黄金フロー autofill ──────────────────────────────────────────
export interface IndividualObs {
  individual_id: string;
  size?: string;
  bloodline?: string;
  sex?: string;
  origin?: string;
  weight_g?: number;
  [k: string]: unknown; // 温度/重量ログ等の観測特徴(テンプレ変数に流用)
}
export interface ListingDraft {
  individual_ids: string[];
  description: string; // テンプレ {{var}} を観測で埋めた説明文
  cited_observations: IndividualObs[]; // 親個体画像/血統/成長履歴の引用
  recommended_price: PriceRecommendation;
}

/** 個体 ID 選択だけで観測引用付き draft を生成(MKT-23)。テンプレの {{key}} を先頭個体の
 *  観測値で置換、推奨価格を recommendPrice(相場スタブ)で自動入力。 */
export function buildListingDraft(
  individuals: IndividualObs[],
  template: string,
  comparables: Comparable[] = [],
): ListingDraft {
  const first = individuals[0] ?? { individual_id: "" };
  const description = (template || "").replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, key: string) => {
    const v = first[key];
    return v === undefined || v === null ? "" : String(v);
  });
  return {
    individual_ids: individuals.map((i) => i.individual_id),
    description,
    cited_observations: individuals,
    recommended_price: recommendPrice(comparables),
  };
}

// ── MKT-20 送料見積り(住所非保持・着払い)────────────────────────────────
export interface ShippingEstimate {
  size: string; // 梱包サイズ区分(60/80/100/120/160)
  yen: number; // 推定送料
  from_office: string;
  to_office: string;
  payment: "cash_on_delivery"; // 着払い前提(住所フィールドは持たない)
}

const SIZE_BUCKETS: [number, string][] = [
  [500, "60"],
  [2000, "80"],
  [5000, "100"],
  [10000, "120"],
  [Infinity, "160"],
];
const SIZE_BASE_YEN: Record<string, number> = { "60": 700, "80": 900, "100": 1100, "120": 1400, "160": 1700 };
const DISTANCE_YEN_PER_UNIT = 100;

function packSize(individuals: IndividualObs[]): string {
  const totalG = individuals.reduce((a, i) => a + (typeof i.weight_g === "number" ? i.weight_g : 0), 0);
  return (SIZE_BUCKETS.find(([max]) => totalG <= max) as [number, string])[1];
}
// 局 ID 末尾数字の差で距離ユニットを近似(住所は使わない)。
// ponytail: 郵便局間の実距離表が着地したら差し込む。今は決定論スタブ。
function distanceUnits(from: string, to: string): number {
  const n = (s: string) => Number((s.match(/\d+/) ?? ["0"])[0]);
  return Math.abs(n(from) - n(to));
}

/** 観測(梱包サイズ)+送/受局 ID から送料を推定(MKT-20)。住所は入力にも出力にも無い。 */
export function estimateShipping(
  individuals: IndividualObs[],
  fromOffice: string,
  toOffice: string,
): ShippingEstimate {
  const size = packSize(individuals);
  const yen = SIZE_BASE_YEN[size] + distanceUnits(fromOffice, toOffice) * DISTANCE_YEN_PER_UNIT;
  return { size, yen, from_office: fromOffice, to_office: toOffice, payment: "cash_on_delivery" };
}

// ── routes ───────────────────────────────────────────────────────────────
// POST /market/listings/draft — 個体 ID 選択で draft 生成(MKT-23)。individuals 未指定時は
// individual_ids から最小スタブ観測を組む(観測投影の本格ロードは別波)。
marketPricingRoutes.post("/market/listings/draft", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const ids = Array.isArray(body?.individual_ids)
    ? (body?.individual_ids as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  if (ids.length === 0) return c.json({ error: "INVALID_DRAFT", details: ["individual_ids required"] }, 400);
  const individuals: IndividualObs[] = Array.isArray(body?.individuals)
    ? (body?.individuals as IndividualObs[])
    : ids.map((id) => ({ individual_id: id }));
  const template = typeof body?.template === "string" ? body.template : "";
  const comparables: Comparable[] = Array.isArray(body?.comparables) ? (body?.comparables as Comparable[]) : [];
  return c.json(buildListingDraft(individuals, template, comparables), 201);
});

// GET /market/listings/{id}/price-recommendation — 過去成約(match の amount)を comparable に
// 集約(embedding 既定 OFF・計算元全公開・MKT-25)。?method=median で中央値。
marketPricingRoutes.get("/market/listings/:id/price-recommendation", async (c) => {
  const listingId = c.req.param("id");
  const txns = (await store(c).listEvents(`truth/${TXN_TYPE}/`)).map(dataOf);
  const comparables: Comparable[] = txns
    .filter((d) => d.kind === "match" && typeof d.amount === "number")
    .map((d) => ({ individual_id: String(d.listing_id), price: d.amount as number, weight: 1 }));
  const method = c.req.query("method") === "median" ? "median" : "weighted_mean";
  return c.json({ listing_id: listingId, ...recommendPrice(comparables, { method }) });
});

// GET /market/listings/{id}/shipping-estimate — 送料見積り(着払い・住所非保持・MKT-20)。
// from_office 省略時は本人の既定局を採用、to_office はクエリ必須(受取側の受取局)。
marketPricingRoutes.get("/market/listings/:id/shipping-estimate", async (c) => {
  const toOffice = c.req.query("to_office") ?? "";
  if (!toOffice) return c.json({ error: "INVALID_ESTIMATE", details: ["to_office required"] }, 400);
  const fromOffice = c.req.query("from_office") ?? (await defaultOffice(c, c.get("actorId"))) ?? "";
  if (!fromOffice) return c.json({ error: "INVALID_ESTIMATE", details: ["from_office (no default post office)"] }, 400);
  const weightG = Number(c.req.query("weight_g"));
  const individuals: IndividualObs[] = [
    { individual_id: c.req.param("id"), weight_g: Number.isFinite(weightG) ? weightG : 0 },
  ];
  return c.json(estimateShipping(individuals, fromOffice, toOffice));
});

// 本人の既定郵便局(最新の is_default=true 行)。住所は保持しない=局 ID のみ。
async function defaultOffice(c: { env: Bindings }, actorId: string): Promise<string | null> {
  const mine = (await store(c).listEvents(`truth/${POST_OFFICE_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.actor_id === actorId && d.is_default === true)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return mine[0] ? String(mine[0].post_office_id) : null;
}

// POST /me/post-offices — 最寄り局を登録(住所非保持・MKT-20)。
marketPricingRoutes.post("/me/post-offices", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const postOfficeId = body && typeof body.post_office_id === "string" ? body.post_office_id.trim() : "";
  if (!postOfficeId) return c.json({ error: "INVALID_POST_OFFICE", details: ["post_office_id required"] }, 400);
  const actorId = c.get("actorId");
  const id = ulid();
  const data = {
    post_office_event_id: id,
    actor_id: actorId,
    post_office_id: postOfficeId,
    is_default: body?.is_default === true,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  const res = await store(c).putEvent({
    specversion: "1.0",
    id,
    source: "apps/api",
    type: POST_OFFICE_TYPE,
    time: new Date().toISOString(),
    dataschema: POST_OFFICE_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  });
  if (res.status === "invalid") return c.json({ error: "INVALID_POST_OFFICE", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_POST_OFFICE", key: res.key }, 409);
  return c.json({ post_office_event_id: id, post_office_id: postOfficeId, is_default: data.is_default }, 201);
});
