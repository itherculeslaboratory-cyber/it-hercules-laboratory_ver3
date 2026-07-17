// MKT-25/23 出品支援。推奨価格(類似個体成約価格→重み付き平均/中央値・計算元込み・
// embedding 既定 OFF)・黄金フロー autofill(個体 ID 選択で観測引用 draft + 推奨価格)。
// 純関数 + 薄い route。MKT-20(送料見積り・郵便局登録)は round-15 裁定で外部URL中継方式へ
// 差替 superseded — 対応する estimateShipping/POST /me/post-offices/shipping-estimate の
// TC はここから削除済み(market-pricing-routes.ts の同スコープ削除に追従)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import {
  recommendPrice,
  buildListingDraft,
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

  // MKT-23 残作業: individuals 省略時に server-side で実観測(species/measurements)+
  // 直系血統を自動集約する(client が組み立て済み observations を要求していた穴の埋め)。
  it("POST /market/listings/draft: individuals省略 → 実個体データ(種/計測/血統)を自動集約", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    // 個体 KID(species=Hercules・weight計測)+ 親 SIRE(sire_role)を実 route 経由で作る。
    const sire = (await (
      await app.request("/api/v1/individuals", { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ species: "Dynastes hercules" }) }, env)
    ).json()) as { individual_id: string };
    const kid = (await (
      await app.request("/api/v1/individuals", { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ species: "Dynastes hercules" }) }, env)
    ).json()) as { individual_id: string };
    await app.request(
      `/api/v1/individuals/${kid.individual_id}/parents`,
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ parent_id: sire.individual_id, parent_role: "sire" }) },
      env,
    );
    // capture(measurements=weight 82.5)を直接 Truth へ append(観測 route の body 形状に
    // 依存せず、observations 投影が読む Truth の形だけを直接検証する=既存 individual.test.ts
    // と同じ「TruthStore 直接 seed」パターン)。
    const { TruthStore, ulid } = await import("@ihl/truth");
    const s = new TruthStore(bucket);
    const captureId = ulid();
    await s.putEvent({
      specversion: "1.0",
      id: captureId,
      source: "apps/api",
      type: "ihl.obs.capture.v1",
      time: new Date().toISOString(),
      dataschema: "schemas/events/obs-capture.schema.json",
      provenance: { generator_kind: "human", actor_id: "dev" },
      data: {
        capture_id: captureId,
        actor_id: "dev",
        domain: "biology",
        subject_ref: `individual/${kid.individual_id}`,
        measurements: [{ item: "weight", kind: "number", value: 82.5, unit: "g" }],
      },
    });

    const res = await app.request(
      "/api/v1/market/listings/draft",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ individual_ids: [kid.individual_id], template: "種 {{species}} / 体重 {{weight}}g" }) },
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      description: string;
      cited_observations: { individual_id: string; species?: string; weight?: number; parents?: { individual_id: string; parent_role?: string }[] }[];
    };
    expect(body.description).toBe(`種 Dynastes hercules / 体重 82.5g`);
    const cited = body.cited_observations[0];
    expect(cited.species).toBe("Dynastes hercules");
    expect(cited.weight).toBe(82.5);
    expect(cited.parents).toEqual([{ individual_id: sire.individual_id, parent_role: "sire", known: true, photo_media_key: undefined }]);
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
});
