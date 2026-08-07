// V3-MKT-27(w1-01実装): 低評価出品者の除外フィルタを GET /market/listings へ配線する
// (lowRatingFlag は market-rating-routes.ts の既存判定関数をそのまま再利用・二重定義
// しない)。オプトイン(既定=除外しない・要件文「除外できる」に対応)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore } from "@ihl/truth";
import { appendKarma } from "../apps/api/src/ledger-routes";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

let seq = 0;
async function seedRating(s: TruthStore, ratee: string, grade: "good" | "normal" | "bad", reason?: string) {
  seq += 1;
  const { ulid } = await import("@ihl/truth");
  const id = ulid();
  const data: Record<string, unknown> = {
    rating_id: id,
    listing_id: `LR${seq}`,
    rater_id: "rater-lowr",
    ratee_id: ratee,
    grade,
    auto: false,
    created_at: `2026-07-12T00:00:${String(seq).padStart(2, "0")}Z`,
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
    provenance: { generator_kind: "human", actor_id: "rater-lowr" },
    data,
  });
  if (res.status !== "inserted") throw new Error(`seed rating failed: ${res.status}`);
}

async function seedListing(bucket: FakeR2Bucket, sellerActorId: string, title: string) {
  // /market/listings の actor_id はセッション principal 強制のため、出品者ごとに
  // 個別のセッショントークンを発行して POST する(market-rating.test.ts と同型)。
  const { issueSessionToken } = await import("../apps/api/src/session");
  const { SESSION_SECRET } = await import("./helpers");
  const token = await issueSessionToken(sellerActorId, SESSION_SECRET);
  const headers = { Authorization: `Bearer ${token}`, "content-type": "application/json" };
  const env = makeEnv(bucket);
  await app.request(
    "/api/v1/market/listings",
    { method: "POST", headers, body: JSON.stringify({ title }) },
    env,
  );
}

describe("V3-MKT-27 GET /market/listings exclude_low_rating フィルタ", () => {
  it("既定(未指定)は除外しない(bad>=5の出品者も一覧に出る)", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    for (let i = 0; i < 5; i++) await seedRating(s, "lr-shady1", "bad", "遅延");
    await appendKarma(s, "lr-shady1", "value", 50, "monthly_batch");
    await seedListing(bucket, "lr-shady1", "低評価出品者の出品(除外なし確認)");

    const res = await app.request("/api/v1/market/listings", { headers: AUTH_HEADERS }, makeEnv(bucket));
    const body = (await res.json()) as { listings: Array<{ title: string }> };
    expect(body.listings.some((l) => l.title === "低評価出品者の出品(除外なし確認)")).toBe(true);
  });

  it("exclude_low_rating=true は bad>=5 の出品者を除外する", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    for (let i = 0; i < 5; i++) await seedRating(s, "lr-shady2", "bad", "遅延");
    await appendKarma(s, "lr-shady2", "value", 50, "monthly_batch");
    await seedListing(bucket, "lr-shady2", "低評価出品者の出品(bad>=5)");

    const res = await app.request(
      "/api/v1/market/listings?exclude_low_rating=true",
      { headers: AUTH_HEADERS },
      makeEnv(bucket),
    );
    const body = (await res.json()) as { listings: Array<{ title: string }> };
    expect(body.listings.some((l) => l.title === "低評価出品者の出品(bad>=5)")).toBe(false);
  });

  it("exclude_low_rating=true は karma<=0 の出品者を除外する", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    await appendKarma(s, "lr-shady3", "value", 0, "monthly_batch"); // karma=0
    await seedListing(bucket, "lr-shady3", "低評価出品者の出品(karma<=0)");

    const res = await app.request(
      "/api/v1/market/listings?exclude_low_rating=true",
      { headers: AUTH_HEADERS },
      makeEnv(bucket),
    );
    const body = (await res.json()) as { listings: Array<{ title: string }> };
    expect(body.listings.some((l) => l.title === "低評価出品者の出品(karma<=0)")).toBe(false);
  });

  it("exclude_low_rating=true は star_avg<=2 の出品者を除外する", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    await seedRating(s, "lr-shady4", "bad", "破損"); // star=1のみ → avg=1<=2
    await appendKarma(s, "lr-shady4", "value", 50, "monthly_batch"); // karmaは+側(karma条件では除外されない)
    await seedListing(bucket, "lr-shady4", "低評価出品者の出品(star_avg<=2)");

    const res = await app.request(
      "/api/v1/market/listings?exclude_low_rating=true",
      { headers: AUTH_HEADERS },
      makeEnv(bucket),
    );
    const body = (await res.json()) as { listings: Array<{ title: string }> };
    expect(body.listings.some((l) => l.title === "低評価出品者の出品(star_avg<=2)")).toBe(false);
  });

  it("exclude_low_rating=true でも健全な出品者(clean)は一覧に残る", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    await seedRating(s, "lr-clean1", "good");
    await seedRating(s, "lr-clean1", "good");
    await appendKarma(s, "lr-clean1", "value", 50, "monthly_batch");
    await seedListing(bucket, "lr-clean1", "健全な出品者の出品");

    const res = await app.request(
      "/api/v1/market/listings?exclude_low_rating=true",
      { headers: AUTH_HEADERS },
      makeEnv(bucket),
    );
    const body = (await res.json()) as { listings: Array<{ title: string }> };
    expect(body.listings.some((l) => l.title === "健全な出品者の出品")).toBe(true);
  });
});
