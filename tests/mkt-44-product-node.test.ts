// V3-MKT-44(design19 §T1-7)。ProductNode 登録/一覧/投影(成功率/失敗率)。
// アフィリエイト実リンクは投入しない(空のときはリンクを出さない)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { TruthStore, ulid } from "@ihl/truth";
import { projectProductSuccessRate } from "../apps/api/src/market-product-node-routes";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}
function post(env: object, headers: Record<string, string>, path: string, body: unknown) {
  return app.request(`/api/v1${path}`, { method: "POST", headers, body: JSON.stringify(body) }, env);
}
function get(env: object, headers: Record<string, string>, path: string) {
  return app.request(`/api/v1${path}`, { headers }, env);
}

async function seedCapture(s: TruthStore, productId: string, individualId: string): Promise<void> {
  const id = ulid();
  const res = await s.putEvent({
    specversion: "1.0",
    id,
    source: "apps/api",
    type: "ihl.obs.capture.v1",
    time: new Date().toISOString(),
    dataschema: "schemas/events/obs-capture.schema.json",
    provenance: { generator_kind: "human", actor_id: "seed-actor" },
    data: {
      capture_id: id,
      actor_id: "seed-actor",
      domain: "biology",
      subject_ref: `individual/${individualId}`,
      product_ref: productId,
    },
  });
  if (res.status !== "inserted") throw new Error(`seed capture failed: ${res.status}`);
}

async function seedLifeEvent(s: TruthStore, individualId: string, kind: "birth" | "death", at: string): Promise<void> {
  const res = await s.putEventAt(`truth/ihl.ind.life_event.v1/${individualId}-${ulid()}.json`, {
    specversion: "1.0",
    id: ulid(),
    source: "apps/api",
    type: "ihl.ind.life_event.v1",
    time: new Date().toISOString(),
    dataschema: "schemas/events/ind-life-event.schema.json",
    provenance: { generator_kind: "human", actor_id: "seed-actor" },
    data: { individual_id: individualId, kind, at, actor_id: "seed-actor" },
  });
  if (res.status !== "inserted") throw new Error(`seed life-event failed: ${res.status}`);
}

describe("V3-MKT-44 ProductNode 登録/一覧/詳細", () => {
  it("登録→一覧→詳細で内容が引ける・affiliate_url未設定は省略される", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const h = bearer(await issueSessionToken("product-owner", SESSION_SECRET));
    const createRes = (await (await post(env, h, "/market/products", { name: "床材A", category: "床材", affiliate_mode: "operator" })).json()) as {
      product_id: string;
    };
    const list = (await (await get(env, h, "/market/products")).json()) as { products: { product_id: string; affiliate_url?: string }[] };
    const found = list.products.find((p) => p.product_id === createRes.product_id);
    expect(found).toBeDefined();
    expect(found!.affiliate_url).toBeUndefined(); // 空の時はリンクを出さない

    const detail = (await (await get(env, h, `/market/products/${createRes.product_id}`)).json()) as {
      product: { name: string };
      stats: unknown;
    };
    expect(detail.product.name).toBe("床材A");
    expect(detail.stats).toBeNull(); // 紐づく個体が0件=未計測
  });

  it("affiliate_mode=self は affiliate_url を保持する", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const h = bearer(await issueSessionToken("product-owner2", SESSION_SECRET));
    const createRes = (await (
      await post(env, h, "/market/products", { name: "ケージB", category: "ケージ", affiliate_mode: "self", affiliate_url: "https://example.com/b" })
    ).json()) as { product_id: string };
    const detail = (await (await get(env, h, `/market/products/${createRes.product_id}`)).json()) as {
      product: { affiliate_url?: string };
    };
    expect(detail.product.affiliate_url).toBe("https://example.com/b");
  });
});

describe("V3-MKT-44 成功率/失敗率投影(obs-capture×ind-life-event)", () => {
  it("死亡が記録された個体は失敗率に、生存中は成功率に計上される", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    await seedCapture(s, "prod-1", "ind-alive-1");
    await seedCapture(s, "prod-1", "ind-dead-1");
    await seedLifeEvent(s, "ind-alive-1", "birth", "2026-01-01T00:00:00Z");
    await seedLifeEvent(s, "ind-dead-1", "birth", "2026-01-01T00:00:00Z");
    await seedLifeEvent(s, "ind-dead-1", "death", "2026-02-01T00:00:00Z");

    const stats = await projectProductSuccessRate(s, "prod-1");
    expect(stats).toEqual({ n: 2, success_rate: 0.5, failure_rate: 0.5 });
  });

  it("survival_correctionがdeathより新しければ生存側へ戻る", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    await seedCapture(s, "prod-2", "ind-corrected-1");
    await seedLifeEvent(s, "ind-corrected-1", "death", "2026-01-01T00:00:00Z");
    await s.putEventAt(`truth/ihl.ind.life_event.v1/ind-corrected-1-${ulid()}.json`, {
      specversion: "1.0",
      id: ulid(),
      source: "apps/api",
      type: "ihl.ind.life_event.v1",
      time: new Date().toISOString(),
      dataschema: "schemas/events/ind-life-event.schema.json",
      provenance: { generator_kind: "human", actor_id: "seed-actor" },
      data: { individual_id: "ind-corrected-1", kind: "survival_correction", at: "2026-01-02T00:00:00Z", actor_id: "seed-actor" },
    });

    const stats = await projectProductSuccessRate(s, "prod-2");
    expect(stats).toEqual({ n: 1, success_rate: 1, failure_rate: 0 });
  });
});
