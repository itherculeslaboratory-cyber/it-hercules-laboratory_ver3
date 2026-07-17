// V3-MKT-35 — POST /economy/vote: プラチナコインを投票通貨とし、対象(target_id)・
// レイヤー(target_layer 0-3)・枚数(coins)・理由(reason)を指定して改善対象へ投票する。
// レイヤー4(固定資産/ブランド/世界観)は投票・フォーク・お気に入り不可のため 403。
// wave-1 gov-g05 レーンの V3-GOV-07(紛争プラチナ投票)とは別object(投票通貨の汎用
// コア=KRM-25 castPlatinumVote を共有・重複実装なし)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, ulid, deriveActorId } from "@ihl/truth";
import { COIN_TYPE } from "../apps/api/src/ledger-routes";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const JSON_HEADERS = { "content-type": "application/json" };
const AUTH_JSON = { Authorization: `Bearer ${DEV_TOKEN}`, ...JSON_HEADERS };
const DEV_ACTOR = await deriveActorId("dev@ihl.local");

function ctx() {
  const bucket = new FakeR2Bucket();
  return { bucket, env: makeEnv(bucket) };
}
async function post(path: string, body: unknown, env: object, headers = AUTH_JSON) {
  return app.request(path, { method: "POST", headers, body: JSON.stringify(body) }, env);
}
async function grantCoins(bucket: FakeR2Bucket, actorId: string, amount: number) {
  const id = ulid();
  await new TruthStore(bucket).putEvent({
    specversion: "1.0",
    id,
    source: "apps/api",
    type: COIN_TYPE,
    time: "2026-07-11T00:00:00Z",
    dataschema: "schemas/frozen/ledger-entry.schema.json",
    provenance: { generator_kind: "human", actor_id: actorId },
    data: {
      coin_event_id: id,
      actor_id: actorId,
      grant_amount: amount,
      reason_code: "vote_reward",
      created_at: "2026-07-11T00:00:00Z",
      schema_version: 1,
    },
  });
}

describe("MKT-35 POST /economy/vote", () => {
  it("unauthenticated -> 401", async () => {
    const { env } = ctx();
    const res = await app.request(
      "/api/v1/economy/vote",
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ target_id: "x", target_layer: 0, coins: 1, reason: "r" }) },
      env,
    );
    expect(res.status).toBe(401);
  });

  it("target_layer=4 (固定資産/ブランド/世界観) -> 403 LAYER4_NOT_VOTABLE", async () => {
    const { bucket, env } = ctx();
    await grantCoins(bucket, DEV_ACTOR, 10);
    const res = await post("/api/v1/economy/vote", { target_id: "brand-1", target_layer: 4, coins: 1, reason: "test" }, env);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("LAYER4_NOT_VOTABLE");
  });

  it("target_layer out of 0-4 range -> 400", async () => {
    const { bucket, env } = ctx();
    await grantCoins(bucket, DEV_ACTOR, 10);
    const res = await post("/api/v1/economy/vote", { target_id: "x", target_layer: 5, coins: 1, reason: "test" }, env);
    expect(res.status).toBe(400);
  });

  it("missing reason -> 400", async () => {
    const { bucket, env } = ctx();
    await grantCoins(bucket, DEV_ACTOR, 10);
    const res = await post("/api/v1/economy/vote", { target_id: "x", target_layer: 0, coins: 1 }, env);
    expect(res.status).toBe(400);
  });

  it("layer 0-3 with sufficient balance + reason -> 201, debits the coin ledger", async () => {
    const { bucket, env } = ctx();
    await grantCoins(bucket, DEV_ACTOR, 10);
    const res = await post("/api/v1/economy/vote", { target_id: "component-x", target_layer: 2, coins: 3, reason: "better performance" }, env);
    expect(res.status).toBe(201);
    const { vote_id } = (await res.json()) as { vote_id: string };
    expect(vote_id).toBeTruthy();

    // 残高チェック: /social/platinum-votes と同じ balance = grant - spent 投影を共有する
    // ため、同じ actor が続けて他対象へ投票すると累積消費される(KRM-25 共有コア確認)。
    const second = await post("/api/v1/economy/vote", { target_id: "component-y", target_layer: 1, coins: 8, reason: "more" }, env);
    expect(second.status).toBe(409); // 10 - 3 = 7 残高 < 8 要求
  });

  it("insufficient balance -> 409 INSUFFICIENT_COINS", async () => {
    const { env } = ctx(); // no grant
    const res = await post("/api/v1/economy/vote", { target_id: "x", target_layer: 0, coins: 1, reason: "test" }, env);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("INSUFFICIENT_COINS");
  });
});
