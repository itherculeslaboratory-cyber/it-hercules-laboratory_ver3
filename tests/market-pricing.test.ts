// MKT-25/23/20 出品支援。推奨価格(類似個体成約価格→重み付き平均/中央値・計算元込み・
// embedding 既定 OFF)・黄金フロー autofill(個体 ID 選択で観測引用 draft + 推奨価格)・
// 送料見積り(観測→梱包サイズ→局間距離・住所非保持・着払い)。純関数 + 薄い route。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import {
  recommendPrice,
  buildListingDraft,
  estimateShipping,
  type Comparable,
} from "../apps/api/src/market-pricing-routes";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

const COMPS: Comparable[] = [
  { individual_id: "I1", price: 1000, weight: 1 },
  { individual_id: "I2", price: 2000, weight: 3 },
  { individual_id: "I3", price: 3000, weight: 1 },
];

describe("MKT-25 recommendPrice(embedding 既定 OFF)", () => {
  it("重み付き平均: Σ(price*w)/Σw・計算元 sources を全公開", () => {
    const r = recommendPrice(COMPS);
    // (1000*1 + 2000*3 + 3000*1) / (1+3+1) = 10000/5 = 2000
    expect(r).toMatchObject({ anchor: 2000, method: "weighted_mean", embedding_used: false });
    expect(r.sources).toEqual([
      { individual_id: "I1", price: 1000, weight: 1 },
      { individual_id: "I2", price: 2000, weight: 3 },
      { individual_id: "I3", price: 3000, weight: 1 },
    ]);
  });

  it("中央値: ソート後の中央値", () => {
    expect(recommendPrice(COMPS, { method: "median" }).anchor).toBe(2000);
    expect(recommendPrice([{ individual_id: "a", price: 100 }, { individual_id: "b", price: 300 }], { method: "median" }).anchor).toBe(200);
  });

  it("embedding は明示 ON 時だけ used=true(既定 OFF・不変条項①)", () => {
    expect(recommendPrice(COMPS, { embedding: true }).embedding_used).toBe(true);
    expect(recommendPrice(COMPS).embedding_used).toBe(false);
  });

  it("comparable なしは anchor 0", () => {
    expect(recommendPrice([]).anchor).toBe(0);
  });
});

describe("MKT-23 buildListingDraft 黄金フロー autofill", () => {
  it("個体観測で {{var}} を埋め・推奨価格を自動入力・観測を引用", () => {
    const draft = buildListingDraft(
      [{ individual_id: "I1", size: "L", bloodline: "Line-A", weight_g: 800 }],
      "サイズ {{size}} / 血統 {{bloodline}}",
      COMPS,
    );
    expect(draft.individual_ids).toEqual(["I1"]);
    expect(draft.description).toBe("サイズ L / 血統 Line-A");
    expect(draft.recommended_price.anchor).toBe(2000);
    expect(draft.cited_observations[0]).toMatchObject({ individual_id: "I1", size: "L" });
  });

  it("未知変数は空に置換(欠損観測でも破綻しない)", () => {
    const draft = buildListingDraft([{ individual_id: "I1" }], "{{size}}-{{missing}}", []);
    expect(draft.description).toBe("-");
  });
});

describe("MKT-20 estimateShipping(住所非保持・着払い)", () => {
  it("観測重量→梱包サイズ→局間距離×サイズで送料・住所フィールド無し", () => {
    const est = estimateShipping([{ individual_id: "I1", weight_g: 800 }], "OFFICE-100", "OFFICE-105");
    expect(est.size).toBe("80"); // 800g → 80 サイズ
    // base 900 + |100-105|*100 = 900 + 500 = 1400
    expect(est.yen).toBe(1400);
    expect(est.payment).toBe("cash_on_delivery");
    expect(est).not.toHaveProperty("address");
    expect(Object.keys(est).sort()).toEqual(["from_office", "payment", "size", "to_office", "yen"]);
  });

  it("重量が増えると梱包サイズ区分が上がる", () => {
    expect(estimateShipping([{ individual_id: "x", weight_g: 100 }], "A1", "A1").size).toBe("60");
    expect(estimateShipping([{ individual_id: "x", weight_g: 6000 }], "A1", "A1").size).toBe("120");
  });
});

describe("pricing routes", () => {
  it("POST /market/listings/draft: individual_ids だけで draft(観測未指定はスタブ)", async () => {
    const res = await app.request(
      "/api/v1/market/listings/draft",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ individual_ids: ["I1", "I2"], template: "個体 {{individual_id}}", comparables: COMPS }) },
      makeEnv(),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { individual_ids: string[]; recommended_price: { anchor: number } };
    expect(body.individual_ids).toEqual(["I1", "I2"]);
    expect(body.recommended_price.anchor).toBe(2000);
  });

  it("POST /market/listings/draft: individual_ids 欠如は 400", async () => {
    const res = await app.request(
      "/api/v1/market/listings/draft",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ template: "x" }) },
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("GET price-recommendation: 過去 match 成約額を comparable に集約(embedding OFF)", async () => {
    const { TruthStore, ulid } = await import("@ihl/truth");
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    // 2 件の成約(match + amount)を seed
    for (const [i, amt] of [[1, 1000], [2, 3000]] as [number, number][]) {
      const id = ulid();
      const res = await s.putEvent({
        specversion: "1.0",
        id,
        source: "apps/api",
        type: "ihl.mkt.transaction_event.v1",
        time: new Date().toISOString(),
        dataschema: "schemas/events/mkt-transaction-event.schema.json",
        provenance: { generator_kind: "human", actor_id: "seller" },
        data: {
          transaction_event_id: id,
          listing_id: `L${i}`,
          actor_id: "seller",
          kind: "match",
          counterparty: "buyer",
          amount: amt,
          created_at: `2026-07-11T00:00:0${i}Z`,
          schema_version: "1",
        },
      });
      if (res.status !== "inserted") throw new Error(`seed txn failed: ${res.status}`);
    }
    const res = await app.request("/api/v1/market/listings/L9/price-recommendation", { headers: AUTH_HEADERS }, makeEnv(bucket));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { anchor: number; embedding_used: boolean; sources: unknown[] };
    expect(body.anchor).toBe(2000); // (1000+3000)/2
    expect(body.embedding_used).toBe(false);
    expect(body.sources.length).toBe(2);
  });

  it("POST /me/post-offices → GET shipping-estimate が既定局を採用(住所非保持)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const reg = await app.request(
      "/api/v1/me/post-offices",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ post_office_id: "OFFICE-100", is_default: true }) },
      env,
    );
    expect(reg.status).toBe(201);
    const est = await app.request(
      "/api/v1/market/listings/L1/shipping-estimate?to_office=OFFICE-105&weight_g=800",
      { headers: AUTH_HEADERS },
      env,
    );
    expect(est.status).toBe(200);
    const body = (await est.json()) as { from_office: string; size: string; yen: number };
    expect(body).toMatchObject({ from_office: "OFFICE-100", size: "80", yen: 1400 });
  });

  it("GET shipping-estimate: to_office 欠如は 400", async () => {
    const res = await app.request("/api/v1/market/listings/L1/shipping-estimate", { headers: AUTH_HEADERS }, makeEnv());
    expect(res.status).toBe(400);
  });
});
