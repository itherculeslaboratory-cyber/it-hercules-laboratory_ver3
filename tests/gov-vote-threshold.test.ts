// Vote / threshold / os-promotion TC(design-c5.md §K6 §4 / V3-GOV-19/23)。threshold_adjust vote→
// projectThreshold が投票結果値を返す(無投票時は caller 供給 base=批評家#3)・os_merge vote+
// スコアで projectOsPromotion が promotable 判定(GOV-23)。単一 actor の連投は dedupVotes で
// 1 票に畳まれ閾値/スコア/promotable を水増しできない(批評家 major)。it 名は ASCII。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, ulid } from "@ihl/truth";
import { OS_PROMOTION_MIN_SCORE } from "../apps/api/src/plaza-constants";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

const VOTE_TYPE = "ihl.gov.vote.v1";
const VOTE_SCHEMA = "schemas/events/gov-vote.schema.json";

function castVote(env: ReturnType<typeof makeEnv>, body: Record<string, unknown>) {
  return app.request("/api/v1/gov/votes", { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(body) }, env);
}
async function getThreshold(env: ReturnType<typeof makeEnv>, ruleId: string, base: number) {
  const res = await app.request(`/api/v1/gov/rules/${ruleId}/threshold?base=${base}`, { headers: AUTH_HEADERS }, env);
  return (await res.json()) as { threshold: number; base: number };
}
async function getPromotion(env: ReturnType<typeof makeEnv>, forkId: string) {
  const res = await app.request(`/api/v1/gov/os/promotion?fork_id=${forkId}`, { headers: AUTH_HEADERS }, env);
  return (await res.json()) as { score: number; promotable: boolean; approve: number };
}
// 単票を直接 seed。actorId を必須にし、1 actor 1 票 dedup(批評家 major)を実測できるよう
// provenance.actor_id / data.actor_id の双方を刻む(projectRanking の vote 加重=5/票)。
async function seedVote(
  bucket: FakeR2Bucket,
  target: string,
  actorId: string,
  extra: Record<string, unknown>,
) {
  const voteId = ulid();
  const iso = new Date().toISOString();
  await new TruthStore(bucket).putEventAt(`truth/${VOTE_TYPE}/${target}/${voteId}.json`, {
    specversion: "1.0",
    id: voteId,
    source: "test",
    type: VOTE_TYPE,
    time: iso,
    dataschema: VOTE_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data: { vote_id: voteId, actor_id: actorId, proposal_target: target, created_at: iso, schema_version: "1", ...extra },
  });
}
function seedOsVote(bucket: FakeR2Bucket, forkId: string, value: "approve" | "reject", actorId: string) {
  return seedVote(bucket, forkId, actorId, { kind: "os_merge", value });
}

describe("gov threshold adjust vote (GOV-19)", () => {
  it("returns the approved adjust_to value from a threshold_adjust vote", async () => {
    const env = makeEnv();
    const r = await castVote(env, { kind: "threshold_adjust", proposal_target: "rule-consensus", value: "approve", adjust_to: 80 });
    expect(r.status).toBe(201);
    const { threshold } = await getThreshold(env, "rule-consensus", 50);
    expect(threshold).toBe(80);
  });

  it("falls back to the caller-supplied base when there is no vote", async () => {
    const env = makeEnv();
    const { threshold, base } = await getThreshold(env, "rule-unvoted", 42);
    expect(base).toBe(42);
    expect(threshold).toBe(42);
  });

  it("ignores a rejected adjust proposal (majority reject keeps base)", async () => {
    const env = makeEnv();
    await castVote(env, { kind: "threshold_adjust", proposal_target: "rule-r", value: "reject", adjust_to: 90 });
    const { threshold } = await getThreshold(env, "rule-r", 50);
    expect(threshold).toBe(50);
  });

  // 批評家 major: 単一 actor の連投で閾値を書き換え不能(dedupVotes で 1 actor 1 票)。
  it("collapses repeat threshold votes from one actor (no ballot stuffing)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    // stuffer が同じ approve(adjust_to=80)を 3 連投、honest が 1 回 reject。
    for (let i = 0; i < 3; i++) await seedVote(bucket, "rule-x", "stuffer", { kind: "threshold_adjust", value: "approve", adjust_to: 80 });
    await seedVote(bucket, "rule-x", "honest", { kind: "threshold_adjust", value: "reject", adjust_to: 80 });
    // dedup 後 approve=1 vs reject=1 → approve>reject 不成立 → base が残る。
    const { threshold } = await getThreshold(env, "rule-x", 50);
    expect(threshold).toBe(50);
  });
});

describe("gov os promotion (GOV-23)", () => {
  it("marks a fork promotable when score >= min AND os_merge approves win", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const votes = Math.ceil(OS_PROMOTION_MIN_SCORE / 5); // vote weight = 5 in RANKING_WEIGHTS
    // 20 の DISTINCT actor が approve(1 actor 1 票の dedup を通しても score が積み上がる)。
    for (let i = 0; i < votes; i++) await seedOsVote(bucket, "fork-hot", "approve", `voter-${i}`);

    const p = await getPromotion(env, "fork-hot");
    expect(p.score).toBeGreaterThanOrEqual(OS_PROMOTION_MIN_SCORE);
    expect(p.approve).toBe(votes);
    expect(p.promotable).toBe(true);
  });

  it("does not promote a fork below the score threshold", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    await seedOsVote(bucket, "fork-cold", "approve", "voter-a");
    await seedOsVote(bucket, "fork-cold", "approve", "voter-b");

    const p = await getPromotion(env, "fork-cold");
    expect(p.score).toBeLessThan(OS_PROMOTION_MIN_SCORE);
    expect(p.promotable).toBe(false);
  });

  // 批評家 major: 単一 actor の os_merge 連投では自己昇格できない(dedupVotes で 1 票に畳む)。
  it("counts a single actor's many os_merge approves as one vote (no self-promotion)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const stuffed = Math.ceil(OS_PROMOTION_MIN_SCORE / 5); // かつては 20 票=score 100 で昇格できた
    for (let i = 0; i < stuffed; i++) await seedOsVote(bucket, "fork-solo", "approve", "stuffer");

    const p = await getPromotion(env, "fork-solo");
    expect(p.approve).toBe(1); // dedup で 1 票
    expect(p.score).toBeLessThan(OS_PROMOTION_MIN_SCORE); // score=5 のみ
    expect(p.promotable).toBe(false);
  });
});

describe("gov vote route is protected", () => {
  it("returns 401 unauthenticated", async () => {
    const env = makeEnv();
    const r = await app.request("/api/v1/gov/votes", { method: "POST", body: "{}" }, env);
    expect(r.status).toBe(401);
  });
});
