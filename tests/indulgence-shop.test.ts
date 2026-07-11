// KRM-05 プラチナコインショップ（免罪符）TC（design-k3 §4）。
// 1 購入=カルマカウント -1 / カウント 0 は不可 / value・Fib は逆操作しない /
// 価格 fib(stage)（購入 +1・暦月 -1）/「プラチナコインショップ」用語。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, deriveActorId, ulid } from "@ihl/truth";
import { grantKarmaCountIncrease, projectLedger } from "../apps/api/src/ledger-routes";
import { PT_TYPE, indulgenceStage, projectPt } from "../apps/api/src/contribution";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const AUTH = { Authorization: `Bearer ${DEV_TOKEN}`, "content-type": "application/json" };
const DEV_ACTOR = await deriveActorId("dev@ihl.local");

// PT を dev actor へ mint（テスト用シード）。
async function mintPt(bucket: FakeR2Bucket, amount: number) {
  const id = ulid();
  await new TruthStore(bucket).putEvent({
    specversion: "1.0",
    id,
    source: "apps/api",
    type: PT_TYPE,
    time: "2026-07-11T00:00:00Z",
    dataschema: "schemas/events/economy-pt-event.schema.json",
    provenance: { generator_kind: "human", actor_id: DEV_ACTOR },
    data: {
      pt_event_id: id,
      actor_id: DEV_ACTOR,
      delta: amount,
      reason_code: "mint",
      created_at: "2026-07-11T00:00:00Z",
      schema_version: "1",
    },
  });
}

describe("KRM-05 免罪符ステージ indulgenceStage（純関数・購入+1/暦月-1）", () => {
  const buy = (created_at: string) => ({
    actor_id: DEV_ACTOR,
    reason_code: "indulgence_spend",
    created_at,
  });

  it("購入無し → stage 1（価格 fib(1)=1PT）", () => {
    expect(indulgenceStage([], DEV_ACTOR, new Date("2026-01-20T00:00:00Z"))).toBe(1);
  });

  it("同月 1 購入 → stage 2 / 同月 2 購入 → stage 3", () => {
    const one = [buy("2026-01-10T00:00:00Z")];
    expect(indulgenceStage(one, DEV_ACTOR, new Date("2026-01-20T00:00:00Z"))).toBe(2);
    const two = [buy("2026-01-10T00:00:00Z"), buy("2026-01-20T00:00:00Z")];
    expect(indulgenceStage(two, DEV_ACTOR, new Date("2026-01-25T00:00:00Z"))).toBe(3);
  });

  it("暦月経過で -1（下限 1）", () => {
    const one = [buy("2026-01-15T00:00:00Z")];
    // 1 か月経過 → 2-1=1
    expect(indulgenceStage(one, DEV_ACTOR, new Date("2026-02-20T00:00:00Z"))).toBe(1);
    // 3 購入（stage4）→ 翌月 -1 → 3
    const three = [
      buy("2026-01-05T00:00:00Z"),
      buy("2026-01-10T00:00:00Z"),
      buy("2026-01-15T00:00:00Z"),
    ];
    expect(indulgenceStage(three, DEV_ACTOR, new Date("2026-02-10T00:00:00Z"))).toBe(3);
  });
});

describe("GET /api/v1/shop/indulgence/price", () => {
  it("初期ステージの価格と「プラチナコインショップ」用語を返す", async () => {
    const res = await app.request("/api/v1/shop/indulgence/price", { headers: AUTH }, makeEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      label: "プラチナコインショップ",
      stage: 1,
      price_pt: 1,
      currency: "PT",
    });
  });

  it("認証なし → 401", async () => {
    const res = await app.request("/api/v1/shop/indulgence/price", {}, makeEnv());
    expect(res.status).toBe(401);
  });
});

describe("POST /api/v1/shop/indulgence", () => {
  it("1 購入でカルマカウント -1・value/Fib は逆操作しない", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    await grantKarmaCountIncrease(new TruthStore(bucket), DEV_ACTOR, 3); // count3, value-4
    await mintPt(bucket, 10);
    const before = await projectLedger(new TruthStore(bucket), DEV_ACTOR);

    const res = await app.request(
      "/api/v1/shop/indulgence",
      { method: "POST", headers: AUTH },
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { spent_pt: number; karma_count: number; karma_value: number };
    expect(body.spent_pt).toBe(1); // fib(1)
    expect(body.karma_count).toBe(before.karma_count - 1); // 3 → 2
    expect(body.karma_value).toBe(before.karma_value); // value は不変（Fib 逆操作なし）

    // PT 残高が価格ぶん減っている。
    expect((await projectPt(new TruthStore(bucket), DEV_ACTOR)).balance).toBe(9);
  });

  it("カルマカウント 0 は購入不可 → 409", async () => {
    const bucket = new FakeR2Bucket();
    await mintPt(bucket, 10); // PT はあるが赦す罪が無い
    const res = await app.request(
      "/api/v1/shop/indulgence",
      { method: "POST", headers: AUTH },
      makeEnv(bucket),
    );
    expect(res.status).toBe(409);
  });

  it("PT 残高不足は購入不可 → 402", async () => {
    const bucket = new FakeR2Bucket();
    await grantKarmaCountIncrease(new TruthStore(bucket), DEV_ACTOR, 3); // count はあるが PT 0
    const res = await app.request(
      "/api/v1/shop/indulgence",
      { method: "POST", headers: AUTH },
      makeEnv(bucket),
    );
    expect(res.status).toBe(402);
  });

  it("連続購入でステージ上昇＝価格上昇（fib(1)→fib(2)→fib(3)）", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    await grantKarmaCountIncrease(new TruthStore(bucket), DEV_ACTOR, 5); // count5
    await mintPt(bucket, 100);

    const spent: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/api/v1/shop/indulgence", { method: "POST", headers: AUTH }, env);
      expect(res.status).toBe(201);
      spent.push(((await res.json()) as { spent_pt: number }).spent_pt);
    }
    expect(spent).toEqual([1, 1, 2]); // fib(1),fib(2),fib(3)
  });
});
