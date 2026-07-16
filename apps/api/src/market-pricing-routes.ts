// MKT-23/25 出品支援(黄金フロー autofill・推奨価格)。全て純関数 + 薄い route。推奨価格は
// 類似個体の過去成約価格を重み付き平均/中央値で集約し計算元を全公開、embedding は既定 OFF
// (明示 ON 時のみ・不変条項①)。
// MKT-20(送料見積り・郵便局登録)は round-15 裁定(user-ruling-2026-07-15-round-15.md #10)で
// 「郵便局ID登録+郵便局間距離×サイズ推定」方式が外部URL中継方式(ゆうパックスマホ割等)へ
// 差替 superseded — このファイルから当該コード(estimateShipping・POST /me/post-offices・
// GET shipping-estimate)は削除済み。price-recommendation は screen-defs/market-trade.json
// で現役参照されており対象外(round-15/16 とも supersede 対象に含まない)。
// 全 route PROTECTED・actor_id はセッション principal 強制(V3-AUT-17)。
import { Hono } from "hono";
import { TruthStore } from "@ihl/truth";
import type { Bindings, Variables } from "./env";

const TXN_TYPE = "ihl.mkt.transaction_event.v1";

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
