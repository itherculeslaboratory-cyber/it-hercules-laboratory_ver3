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
import { projectIndividual, buildPedigree } from "./individual-routes";

const TXN_TYPE = "ihl.mkt.transaction_event.v1";
const PHOTO_TYPE = "ihl.obs.photo.v1";

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

// 過去成約(match の amount)を comparable に集約(price-recommendation と共用)。
async function loadSoldComparables(s: TruthStore): Promise<Comparable[]> {
  const txns = (await s.listEvents(`truth/${TXN_TYPE}/`)).map(dataOf);
  return txns
    .filter((d) => d.kind === "match" && typeof d.amount === "number")
    .map((d) => ({ individual_id: String(d.listing_id), price: d.amount as number, weight: 1 }));
}

// MKT-23「個体を選ぶだけで9割完成」: individual_ids だけから実観測(V3-IND-13
// projectIndividual)+直系血統(V3-IND-12 buildPedigree)を server-side で自動集約する
// (client が既に組み立てた observations を要求していた既存 API の穴埋め=残作業本体)。
// measurements は自由記述(item/value)なのでフィールド名を決め打ちせず、全 capture の
// 全 item をそのままテンプレ変数名(item名)としてフラット化する(=テンプレ {{item名}}
// と1:1対応・命名推測が要らない)。同名 item は後勝ち(直近 capture 優先・listEvents は
// R2 prefix scan=capture_id(ULID)キー順で本番は時系列・fake bucket は挿入順で近似)。
export async function autoDeriveIndividualObs(s: TruthStore, individualId: string): Promise<IndividualObs> {
  const proj = await projectIndividual(s, individualId);
  const out: IndividualObs = { individual_id: individualId };
  if (!proj) return out; // 個体不明でも400にはしない(=IDだけの最小スタブへ自然縮退)
  const master = proj.master as Record<string, unknown> | null;
  if (master && typeof master.species === "string" && master.species) out.species = master.species;

  for (const obs of proj.observations) {
    const rec = obs as Record<string, unknown>;
    if (typeof rec.sire_id === "string") out.sire_id = rec.sire_id;
    if (typeof rec.dam_id === "string") out.dam_id = rec.dam_id;
    const measurements = Array.isArray(rec.measurements) ? rec.measurements : [];
    for (const m of measurements as Record<string, unknown>[]) {
      if (typeof m.item === "string" && (typeof m.value === "string" || typeof m.value === "number")) {
        out[m.item] = m.value;
      }
    }
  }
  out.observation_count = proj.observations.length; // 温度/重量ログ全期間の件数(生ログは別APIで参照)
  out.timeline_count = proj.timeline.length; // 成長履歴(life-event)件数

  // 親個体(直系のみ・maxDepth=1)。画像は親個体の capture に紐づく最初の photo を採用。
  const pedigree = await buildPedigree(s, individualId, 1);
  const parents: { individual_id: string; parent_role?: string; known: boolean; photo_media_key?: string }[] = [];
  for (const p of pedigree.parents) {
    let photoMediaKey: string | undefined;
    const parentProj = p.known ? await projectIndividual(s, p.individual_id) : null;
    for (const obs of parentProj?.observations ?? []) {
      const capId = (obs as Record<string, unknown>).capture_id;
      if (typeof capId !== "string") continue;
      const photos = (await s.listEvents(`truth/${PHOTO_TYPE}/${capId}-`)).map(dataOf);
      if (photos.length && typeof photos[0].photo_id === "string") {
        photoMediaKey = `media/photo/${photos[0].photo_id}`;
        break;
      }
    }
    parents.push({ individual_id: p.individual_id, parent_role: p.parent_role, known: p.known, photo_media_key: photoMediaKey });
  }
  if (parents.length) out.parents = parents;
  return out;
}

// ── routes ───────────────────────────────────────────────────────────────
// POST /market/listings/draft — 個体 ID 選択で draft 生成(MKT-23)。individuals 省略時は
// autoDeriveIndividualObs で実観測+血統を自動集約(旧: client 供給の observations 必須
// だった穴を埋める=本要件の残作業)。comparables 省略時は全成約履歴を既定候補として使う
// (種族/血統での絞り込みは listing↔individual 参照が無くまだできない=ponytail、
// listing 側に individual 参照が付いたら絞り込みへ差し替え)。
marketPricingRoutes.post("/market/listings/draft", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const ids = Array.isArray(body?.individual_ids)
    ? (body?.individual_ids as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  if (ids.length === 0) return c.json({ error: "INVALID_DRAFT", details: ["individual_ids required"] }, 400);
  const s = store(c);
  const individuals: IndividualObs[] = Array.isArray(body?.individuals)
    ? (body?.individuals as IndividualObs[])
    : await Promise.all(ids.map((id) => autoDeriveIndividualObs(s, id)));
  const template = typeof body?.template === "string" ? body.template : "";
  const comparables: Comparable[] = Array.isArray(body?.comparables)
    ? (body?.comparables as Comparable[])
    : await loadSoldComparables(s);
  return c.json(buildListingDraft(individuals, template, comparables), 201);
});

// GET /market/listings/{id}/price-recommendation — 過去成約(match の amount)を comparable に
// 集約(embedding 既定 OFF・計算元全公開・MKT-25)。?method=median で中央値。
marketPricingRoutes.get("/market/listings/:id/price-recommendation", async (c) => {
  const listingId = c.req.param("id");
  const comparables = await loadSoldComparables(store(c));
  const method = c.req.query("method") === "median" ? "median" : "weighted_mean";
  return c.json({ listing_id: listingId, ...recommendPrice(comparables, { method }) });
});
