// KRM-25 プラチナ投票 TC（design-k3 §4）。1票=1coin 積み上げ公開合計値・投票者内訳
// 全公開・閾値到達で公式昇格候補化（候補化のみ・実昇格は人間ゲート）。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, deriveActorId, ulid } from "@ihl/truth";
import { projectPlatinumVoteTally } from "../apps/api/src/social-routes";
import { grantPlatinum } from "../apps/api/src/ledger-routes";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

const DEV_ACTOR = await deriveActorId("dev@ihl.local");
const VOTE_TYPE = "ihl.social.platinum_vote.v1";

async function seedVote(s: TruthStore, target: string, voter: string, coins: number): Promise<void> {
  const id = ulid();
  const res = await s.putEvent({
    specversion: "1.0", id, source: "apps/api", type: VOTE_TYPE,
    time: "2026-07-11T00:00:00Z", dataschema: "schemas/events/social-platinum-vote.schema.json",
    provenance: { generator_kind: "human", actor_id: voter },
    data: {
      vote_id: id, target_id: target, voter_id: voter, coins,
      created_at: "2026-07-11T00:00:00Z", schema_version: "1",
    },
  });
  if (res.status !== "inserted") throw new Error(`seed vote failed: ${res.status}`);
}

describe("KRM-25 projectPlatinumVoteTally", () => {
  it("1票=1coin を任意枚数で積み上げ・投票者別内訳を公開", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await seedVote(s, "P1", "alice", 3);
    await seedVote(s, "P1", "bob", 2);
    await seedVote(s, "P1", "alice", 1); // alice 追加 → 内訳は合算
    const t = await projectPlatinumVoteTally(s, "P1", 100);
    expect(t.total).toBe(6);
    const alice = t.breakdown.find((b) => b.voter_id === "alice");
    const bob = t.breakdown.find((b) => b.voter_id === "bob");
    expect(alice?.coins).toBe(4);
    expect(bob?.coins).toBe(2);
    expect(t.candidate).toBe(false); // 6 < 100
  });

  it("閾値到達で公式昇格候補化（candidate=true）", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await seedVote(s, "P2", "whale", 100);
    const t = await projectPlatinumVoteTally(s, "P2", 100);
    expect(t.total).toBe(100);
    expect(t.official_threshold).toBe(100);
    expect(t.candidate).toBe(true);
  });

  it("他対象の票は混ざらない", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await seedVote(s, "P3", "u", 5);
    await seedVote(s, "P4", "u", 9);
    expect((await projectPlatinumVoteTally(s, "P3", 100)).total).toBe(5);
  });
});

describe("POST /api/v1/social/platinum-votes + GET /api/v1/proposals/{id}/votes", () => {
  it("認証なしは 401", async () => {
    const res = await app.request("/api/v1/social/platinum-votes", { method: "POST" }, makeEnv());
    expect(res.status).toBe(401);
  });

  it("coins<1 は 400", async () => {
    const res = await app.request(
      "/api/v1/social/platinum-votes",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ target_id: "P1", coins: 0 }) },
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("残高不足は 409（付与コインを超える投票は拒否・V3-KRM-25）", async () => {
    const bucket = new FakeR2Bucket();
    await grantPlatinum(new TruthStore(bucket), DEV_ACTOR, 3); // 付与 3 コイン
    const res = await app.request(
      "/api/v1/social/platinum-votes",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ target_id: "PROP-X", coins: 5 }) },
      makeEnv(bucket),
    );
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "INSUFFICIENT_COINS", balance: 3 });
  });

  it("投票済コインを差し引いた残高で判定（2 回目は残高不足 409）", async () => {
    const bucket = new FakeR2Bucket();
    await grantPlatinum(new TruthStore(bucket), DEV_ACTOR, 5);
    const first = await app.request(
      "/api/v1/social/platinum-votes",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ target_id: "PROP-A", coins: 4 }) },
      makeEnv(bucket),
    );
    expect(first.status).toBe(201);
    const second = await app.request(
      "/api/v1/social/platinum-votes",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ target_id: "PROP-B", coins: 2 }) },
      makeEnv(bucket),
    );
    expect(second.status).toBe(409); // 残高 5-4=1 < 2
  });

  it("投票は 201・voter_id はセッション principal・votes GET で合計 + 内訳が公開", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    await grantPlatinum(new TruthStore(bucket), DEV_ACTOR, 10); // 投票原資を付与
    const post = await app.request(
      "/api/v1/social/platinum-votes",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ target_id: "PROP-1", coins: 7 }) },
      env,
    );
    expect(post.status).toBe(201);

    const res = await app.request("/api/v1/proposals/PROP-1/votes", { headers: AUTH_HEADERS }, makeEnv(bucket));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number; breakdown: { voter_id: string; coins: number }[]; candidate: boolean;
    };
    expect(body.total).toBe(7);
    expect(body.breakdown).toEqual([{ voter_id: DEV_ACTOR, coins: 7 }]);
    expect(body.candidate).toBe(false);
  });
});
