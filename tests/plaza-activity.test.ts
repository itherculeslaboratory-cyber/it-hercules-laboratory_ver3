// V3-BBS-18 — Stream層(既存Truthストリーム横断の読み取り専用マージ投影)。
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { TruthStore } from "@ihl/truth";
import { plazaActivityRoutes, projectActivityStream, ACTIVITY_DOMAINS } from "../apps/api/src/plaza-activity-routes";
import { FakeR2Bucket, makeEnv, makeEnvelope } from "./helpers";

const app = new Hono<{ Bindings: ReturnType<typeof makeEnv> }>();
app.route("/api/v1", plazaActivityRoutes);

function ctx() {
  const bucket = new FakeR2Bucket();
  return { bucket, env: makeEnv(bucket) };
}

// 各ドメインの実際のTruthキー規約(各所有routeファイルの実装どおり)で直接シードする
// (HTTP経由だとドメインごとに別々の認証/バリデーションを踏むため、本テストでは
// TruthStoreへ直接書いてStream側の集約ロジックだけを検証する)。
async function seedDomainEvent(bucket: FakeR2Bucket, type: string, actorId: string, createdAt: string, extra: Record<string, unknown> = {}) {
  const store = new TruthStore(bucket);
  const id = `${type}-${createdAt}-${Math.random().toString(36).slice(2)}`;
  await store.putEventAt(
    `truth/${type}/${id}.json`,
    makeEnvelope({ type, data: { actor_id: actorId, created_at: createdAt, ...extra } }),
  );
}

describe("V3-BBS-18 projectActivityStream (cross-domain merge, read-only)", () => {
  it("merges multiple existing domains for one actor, sorted created_at desc", async () => {
    const { bucket } = ctx();
    await seedDomainEvent(bucket, "ihl.economy.karma_event.v1", "actor-1", "2026-08-01T01:00:00Z");
    await seedDomainEvent(bucket, "ihl.economy.coin_event.v1", "actor-1", "2026-08-01T03:00:00Z");
    await seedDomainEvent(bucket, "ihl.plaza.post.v1", "actor-1", "2026-08-01T02:00:00Z");
    await seedDomainEvent(bucket, "ihl.economy.karma_event.v1", "actor-2", "2026-08-01T04:00:00Z"); // 別actor

    const rows = await projectActivityStream(new TruthStore(bucket), "actor-1");
    expect(rows.map((r) => r.domain)).toEqual(["platinum", "thread_update", "karma"]);
    expect(rows.every((r) => r.actor_id === "actor-1")).toBe(true);
  });

  it("domainKeys filters to a subset", async () => {
    const { bucket } = ctx();
    await seedDomainEvent(bucket, "ihl.economy.karma_event.v1", "actor-1", "2026-08-01T01:00:00Z");
    await seedDomainEvent(bucket, "ihl.mkt.rating.v1", "actor-1", "2026-08-01T02:00:00Z");
    const rows = await projectActivityStream(new TruthStore(bucket), "actor-1", ["karma"]);
    expect(rows.map((r) => r.domain)).toEqual(["karma"]);
  });

  it("no actor_id filter returns rows across all seeded actors", async () => {
    const { bucket } = ctx();
    await seedDomainEvent(bucket, "ihl.economy.karma_event.v1", "actor-1", "2026-08-01T01:00:00Z");
    await seedDomainEvent(bucket, "ihl.economy.karma_event.v1", "actor-2", "2026-08-01T02:00:00Z");
    const rows = await projectActivityStream(new TruthStore(bucket), undefined, ["karma"]);
    expect(rows.map((r) => r.actor_id).sort()).toEqual(["actor-1", "actor-2"]);
  });

  it("ACTIVITY_DOMAINS only lists verified-existing streams (10 entries, no fabricated ones)", () => {
    expect(ACTIVITY_DOMAINS.length).toBe(10);
    const keys = ACTIVITY_DOMAINS.map((d) => d.key);
    // 要件文にある「称号」「AI新聞」「マーケット中止」に対応するTruthストリームは
    // grepで実在確認できなかったため対象外(正直な表示・捏造しない)。
    expect(keys).not.toContain("title");
    expect(keys).not.toContain("ai_newspaper");
    expect(keys).not.toContain("market_cancel");
  });
});

describe("GET /plaza/activity-stream / GET /plaza/activity-domains", () => {
  it("GET /plaza/activity-domains lists the verified domains", async () => {
    const res = await app.request("/api/v1/plaza/activity-domains", {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { domains: { key: string }[] };
    expect(body.domains.length).toBe(10);
  });

  it("GET /plaza/activity-stream?actor_id=... returns merged rows", async () => {
    const bucket = new FakeR2Bucket();
    await seedDomainEvent(bucket, "ihl.economy.karma_event.v1", "actor-9", "2026-08-01T01:00:00Z");
    const res = await app.request("/api/v1/plaza/activity-stream?actor_id=actor-9&domains=karma", {}, makeEnv(bucket));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { actor_id: string; rows: { domain: string }[] };
    expect(body.actor_id).toBe("actor-9");
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].domain).toBe("karma");
  });
});
