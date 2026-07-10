// C4 経済系 台帳 + カルマ二層 TC (design-c4 §1 / V3-KRM-01・02 / V3-AUT-17).
// フィボナッチ判定(確定数値)・イベント列→残高再計算の一致・付与関数・
// GET /api/v1/me/ledger 本人スコープ + 他人の台帳が見えない negative。
// CL-12 の形式凍結/append-only は tests/cl-12-ledger.test.ts が別途維持。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, deriveActorId } from "@ihl/truth";
import {
  fib,
  fibPenalty,
  projectLedger,
  grantKarmaCountIncrease,
  grantPlatinum,
} from "../apps/api/src/ledger-routes";
import {
  FIB_PENALTY_ANCHOR_0_5,
  FIB_PENALTY_ANCHOR_5_10,
} from "../apps/api/src/economy-constants";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const AUTH = { Authorization: `Bearer ${DEV_TOKEN}` };
const DEV_ACTOR = await deriveActorId("dev@ihl.local");

describe("V3-KRM-02 Fibonacci カルマ減点(確定数値)", () => {
  it("Fib(1..10) は標準フィボナッチ", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(fib)).toEqual([1, 1, 2, 3, 5, 8, 13, 21, 34, 55]);
  });

  it("fibPenalty(0,5)=12 / fibPenalty(5,10)=131(registry V3-KRM-02 の検算アンカー)", () => {
    expect(fibPenalty(0, 5)).toBe(FIB_PENALTY_ANCHOR_0_5);
    expect(fibPenalty(5, 10)).toBe(FIB_PENALTY_ANCHOR_5_10);
  });

  it("逐次適用と一括は等価(0→5 = 0→2 と 2→5 の和)", () => {
    expect(fibPenalty(0, 2) + fibPenalty(2, 5)).toBe(fibPenalty(0, 5));
  });
});

describe("台帳投影(都度再計算)", () => {
  it("イベント列 → 残高再計算が一致(karma 二層 + platinum)", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await grantKarmaCountIncrease(s, DEV_ACTOR, 5); // count +5, value -12
    await grantPlatinum(s, DEV_ACTOR, 1);
    await grantPlatinum(s, DEV_ACTOR, 2);

    const p = await projectLedger(s, DEV_ACTOR);
    expect(p.karma_count).toBe(5);
    expect(p.karma_value).toBe(-FIB_PENALTY_ANCHOR_0_5); // -12
    expect(p.platinum_coins).toBe(3);
  });

  it("累犯は逐次で急増: 0→5→10 で value = -(12+131)", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await grantKarmaCountIncrease(s, DEV_ACTOR, 5); // 0→5
    await grantKarmaCountIncrease(s, DEV_ACTOR, 5); // 5→10 (投影で現カウント5を読む)
    const p = await projectLedger(s, DEV_ACTOR);
    expect(p.karma_count).toBe(10);
    expect(p.karma_value).toBe(-100); // -(12+131)=-143 を [-100,100] にクランプ
  });

  it("投影は本人分のみ集計(他人の event は載らない)", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    const other = await deriveActorId("other@ihl.local");
    await grantKarmaCountIncrease(s, other, 5);
    await grantPlatinum(s, other, 9);
    const p = await projectLedger(s, DEV_ACTOR);
    expect(p).toEqual({ actor_id: DEV_ACTOR, karma_value: 0, karma_count: 0, platinum_coins: 0 });
  });
});

describe("GET /api/v1/me/ledger(本人スコープ・V3-AUT-17)", () => {
  it("認証なし → 401", async () => {
    const res = await app.request("/api/v1/me/ledger", {}, makeEnv());
    expect(res.status).toBe(401);
  });

  it("セッション principal の投影を返す", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    await grantKarmaCountIncrease(new TruthStore(bucket), DEV_ACTOR, 5);
    await grantPlatinum(new TruthStore(bucket), DEV_ACTOR, 1);

    const res = await app.request("/api/v1/me/ledger", { headers: AUTH }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      actor_id: DEV_ACTOR,
      karma_value: -12,
      karma_count: 5,
      platinum_coins: 1,
    });
  });

  it("他人の台帳は見えない: 別 actor の event を seed しても本人分は 0", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const other = await deriveActorId("attacker@ihl.local");
    await grantKarmaCountIncrease(new TruthStore(bucket), other, 5);
    await grantPlatinum(new TruthStore(bucket), other, 7);

    const res = await app.request("/api/v1/me/ledger", { headers: AUTH }, env);
    const body = (await res.json()) as { karma_count: number; platinum_coins: number };
    expect(body.karma_count).toBe(0);
    expect(body.platinum_coins).toBe(0);
  });
});
