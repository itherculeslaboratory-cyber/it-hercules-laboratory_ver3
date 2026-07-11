// MKT-27 取引評価(ADR-H-08 件数モデル)。good/normal/bad 集計・grade=bad の reason
// 必須(route + schema 二重)・低評価フィルタ(bad≥5 || karma≤0 || star_avg≤2)を投影で
// 導出。rater_id はセッション principal 強制(V3-AUT-17)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, deriveActorId, ulid } from "@ihl/truth";
import {
  projectRating,
  lowRatingFlag,
  type RatingSummary,
} from "../apps/api/src/market-rating-routes";
import { appendKarma } from "../apps/api/src/ledger-routes";
import { AUTH_HEADERS, DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const DEV_ACTOR = await deriveActorId("dev@ihl.local");

let seq = 0;
async function seedRating(
  s: TruthStore,
  ratee: string,
  grade: "good" | "normal" | "bad",
  reason?: string,
): Promise<void> {
  seq += 1;
  const id = ulid();
  const data: Record<string, unknown> = {
    rating_id: id,
    listing_id: `L${seq}`,
    rater_id: "rater-x",
    ratee_id: ratee,
    grade,
    auto: false,
    created_at: `2026-07-11T00:00:${String(seq).padStart(2, "0")}Z`,
    schema_version: "1",
  };
  if (reason) data.reason = reason;
  const res = await s.putEvent({
    specversion: "1.0",
    id,
    source: "apps/api",
    type: "ihl.mkt.rating.v1",
    time: new Date().toISOString(),
    dataschema: "schemas/events/mkt-rating.schema.json",
    provenance: { generator_kind: "human", actor_id: "rater-x" },
    data,
  });
  if (res.status !== "inserted") throw new Error(`seed rating failed: ${res.status}`);
}

describe("MKT-27 projectRating 件数モデル", () => {
  it("good/normal/bad を集計し star_avg を加重平均(good5/normal3/bad1)", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await seedRating(s, "seller", "good");
    await seedRating(s, "seller", "good");
    await seedRating(s, "seller", "normal");
    await seedRating(s, "seller", "bad", "遅延");
    const r = await projectRating(s, "seller");
    expect(r).toMatchObject({ good: 2, normal: 1, bad: 1, trades: 4 });
    // (5+5+3+1)/4 = 3.5
    expect(r.star_avg).toBeCloseTo(3.5, 5);
  });

  it("評価なしは star_avg=null(星条件を適用しない)", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    const r = await projectRating(s, "nobody");
    expect(r).toMatchObject({ good: 0, normal: 0, bad: 0, trades: 0, star_avg: null });
  });

  it("被評価者スコープ: 他人宛の評価は載らない", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await seedRating(s, "A", "good");
    await seedRating(s, "B", "bad", "x");
    expect((await projectRating(s, "A")).good).toBe(1);
    expect((await projectRating(s, "A")).bad).toBe(0);
  });
});

describe("MKT-27 lowRatingFlag 低評価フィルタ", () => {
  const base: RatingSummary = { actor_id: "u", good: 3, normal: 0, bad: 0, trades: 3, star_avg: 5 };
  it("bad≥5 で低評価", () => {
    expect(lowRatingFlag({ ...base, bad: 5 }, 50)).toBe(true);
    expect(lowRatingFlag({ ...base, bad: 4 }, 50)).toBe(false);
  });
  it("karma≤0 で低評価", () => {
    expect(lowRatingFlag(base, 0)).toBe(true);
    expect(lowRatingFlag(base, -1)).toBe(true);
    expect(lowRatingFlag(base, 1)).toBe(false);
  });
  it("star_avg≤2 で低評価・null は星条件を適用しない", () => {
    expect(lowRatingFlag({ ...base, star_avg: 2 }, 50)).toBe(true);
    expect(lowRatingFlag({ ...base, star_avg: 2.1 }, 50)).toBe(false);
    expect(lowRatingFlag({ ...base, star_avg: null }, 50)).toBe(false); // 評価なし+karma+ → 非低評価
  });
});

describe("POST /api/v1/market/ratings", () => {
  it("認証なしは 401", async () => {
    const res = await app.request("/api/v1/market/ratings", { method: "POST" }, makeEnv());
    expect(res.status).toBe(401);
  });

  it("grade=bad で reason 欠如は 400", async () => {
    const res = await app.request(
      "/api/v1/market/ratings",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ listing_id: "L1", ratee_id: "seller", grade: "bad" }) },
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("grade=bad + reason は 201・rater_id はセッション principal", async () => {
    const bucket = new FakeR2Bucket();
    const res = await app.request(
      "/api/v1/market/ratings",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ listing_id: "L1", ratee_id: "seller", grade: "bad", reason: "破損" }) },
      makeEnv(bucket),
    );
    expect(res.status).toBe(201);
    const r = await projectRating(new TruthStore(bucket), "seller");
    expect(r.bad).toBe(1);
    // rater_id はセッション actor(body に rater は無い)= DEV_ACTOR
    const ev = [...bucket.objects.values()][0];
    expect(JSON.parse(ev.body as string).data.rater_id).toBe(DEV_ACTOR);
  });

  it("good は 201", async () => {
    const res = await app.request(
      "/api/v1/market/ratings",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ listing_id: "L2", ratee_id: "seller", grade: "good" }) },
      makeEnv(),
    );
    expect(res.status).toBe(201);
  });
});

describe("GET /api/v1/market/users/{actor}/ratings 公開 + 低評価フィルタ", () => {
  it("clean(karma>0・good 評価)は low_rating=false", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    await seedRating(s, "clean", "good");
    await seedRating(s, "clean", "good");
    await appendKarma(s, "clean", "value", 50, "monthly_batch"); // karma>0(救済経路)
    const res = await app.request("/api/v1/market/users/clean/ratings", { headers: AUTH_HEADERS }, makeEnv(bucket));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { good: number; karma_value: number; low_rating: boolean };
    expect(body).toMatchObject({ good: 2, karma_value: 50, low_rating: false });
  });

  it("bad≥5 は low_rating=true", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    for (let i = 0; i < 5; i++) await seedRating(s, "shady", "bad", "遅延");
    await appendKarma(s, "shady", "value", 50, "monthly_batch");
    const res = await app.request("/api/v1/market/users/shady/ratings", { headers: AUTH_HEADERS }, makeEnv(bucket));
    const body = (await res.json()) as { bad: number; low_rating: boolean };
    expect(body).toMatchObject({ bad: 5, low_rating: true });
  });
});
