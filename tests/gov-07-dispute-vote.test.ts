// V3-GOV-07: プラチナ投票による紛争裁定。当事者が「公開して投票」を選んだ場合のみ開始
// (publicize)・7日間投票窓・1票=1PT消費・PT残高≥1で誰でも投票可・二択(売り手が正しい/
// 買い手が正しい)・多数派勝ち(同数=引き分けでカルマ変動なし)・結果は判例R2に記録・
// 敗者Δcount+5を1回だけ反映・quorumなし。
import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, ulid } from "@ihl/truth";
import { issueSessionToken } from "../apps/api/src/session";
import { PT_TYPE, projectPt } from "../apps/api/src/contribution";
import { projectLedger } from "../apps/api/src/ledger-routes";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

async function bearer(actorId: string) {
  return { Authorization: `Bearer ${await issueSessionToken(actorId, SESSION_SECRET)}`, "content-type": "application/json" };
}

async function mintPt(bucket: FakeR2Bucket, actorId: string, amount: number) {
  const id = ulid();
  await new TruthStore(bucket).putEvent({
    specversion: "1.0", id, source: "apps/api", type: PT_TYPE,
    time: new Date().toISOString(), dataschema: "schemas/events/economy-pt-event.schema.json",
    provenance: { generator_kind: "human", actor_id: actorId },
    data: { pt_event_id: id, actor_id: actorId, delta: amount, reason_code: "mint", created_at: new Date().toISOString(), schema_version: "1" },
  });
}

async function openMarketDispute(env: object, openerH: Record<string, string>, respondentId: string) {
  const res = await app.request(
    "/api/v1/gov/disputes",
    { method: "POST", headers: openerH, body: JSON.stringify({ category: "market", respondent_id: respondentId }) },
    env,
  );
  return ((await res.json()) as { dispute_id: string }).dispute_id;
}

describe("V3-GOV-07 publicize (当事者限定・公開して投票の開始)", () => {
  it("a third party cannot publicize (403 NOT_A_PARTICIPANT)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const openerH = await bearer("seller-1");
    const disputeId = await openMarketDispute(env, openerH, "buyer-1");
    const outsiderH = await bearer("outsider");
    const res = await app.request(
      `/api/v1/gov/disputes/${disputeId}/publicize`,
      { method: "POST", headers: outsiderH, body: JSON.stringify({ opener_role: "seller" }) },
      env,
    );
    expect(res.status).toBe(403);
  });

  it("missing/invalid opener_role -> 400", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const openerH = await bearer("seller-2");
    const disputeId = await openMarketDispute(env, openerH, "buyer-2");
    const res = await app.request(
      `/api/v1/gov/disputes/${disputeId}/publicize`,
      { method: "POST", headers: openerH, body: JSON.stringify({ opener_role: "nope" }) },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("participant publicizes -> 201, dispute becomes public with a 7-day deadline", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const openerH = await bearer("seller-3");
    const disputeId = await openMarketDispute(env, openerH, "buyer-3");
    const res = await app.request(
      `/api/v1/gov/disputes/${disputeId}/publicize`,
      { method: "POST", headers: openerH, body: JSON.stringify({ opener_role: "seller" }) },
      env,
    );
    expect(res.status).toBe(201);
    const view = (await (await app.request(`/api/v1/gov/disputes/${disputeId}`, { headers: openerH }, env)).json()) as {
      public: boolean; opener_role: string; publicized_at: string; vote_deadline: string;
    };
    expect(view.public).toBe(true);
    expect(view.opener_role).toBe("seller");
    const days = (Date.parse(view.vote_deadline) - Date.parse(view.publicized_at)) / (24 * 60 * 60 * 1000);
    expect(days).toBeCloseTo(7, 5);
  });

  it("double publicize -> 409 ALREADY_PUBLIC", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const openerH = await bearer("seller-4");
    const disputeId = await openMarketDispute(env, openerH, "buyer-4");
    await app.request(`/api/v1/gov/disputes/${disputeId}/publicize`, { method: "POST", headers: openerH, body: JSON.stringify({ opener_role: "seller" }) }, env);
    const res = await app.request(`/api/v1/gov/disputes/${disputeId}/publicize`, { method: "POST", headers: openerH, body: JSON.stringify({ opener_role: "seller" }) }, env);
    expect(res.status).toBe(409);
  });
});

describe("V3-GOV-07 votes (1票=1PT・PT残高ゲート・二択・1 actor 1票)", () => {
  async function publicDispute(bucket: FakeR2Bucket, env: object) {
    const openerH = await bearer("seller-5");
    const disputeId = await openMarketDispute(env, openerH, "buyer-5");
    await app.request(`/api/v1/gov/disputes/${disputeId}/publicize`, { method: "POST", headers: openerH, body: JSON.stringify({ opener_role: "seller" }) }, env);
    return disputeId;
  }

  it("not yet public -> 400 NOT_PUBLIC", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const openerH = await bearer("seller-6");
    const disputeId = await openMarketDispute(env, openerH, "buyer-6");
    const voterH = await bearer("voter-1");
    await mintPt(bucket, "voter-1", 5);
    const res = await app.request(`/api/v1/gov/disputes/${disputeId}/votes`, { method: "POST", headers: voterH, body: JSON.stringify({ value: "seller" }) }, env);
    expect(res.status).toBe(400);
  });

  it("no PT balance -> 402 INSUFFICIENT_PT (no vote recorded, no charge)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const disputeId = await publicDispute(bucket, env);
    const voterH = await bearer("voter-broke");
    const res = await app.request(`/api/v1/gov/disputes/${disputeId}/votes`, { method: "POST", headers: voterH, body: JSON.stringify({ value: "seller" }) }, env);
    expect(res.status).toBe(402);
  });

  it("valid vote spends exactly 1 PT and is counted; anyone (even non-participants) with PT can vote", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const disputeId = await publicDispute(bucket, env);
    const voterH = await bearer("voter-2");
    await mintPt(bucket, "voter-2", 3);
    const res = await app.request(`/api/v1/gov/disputes/${disputeId}/votes`, { method: "POST", headers: voterH, body: JSON.stringify({ value: "buyer" }) }, env);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ value: "buyer", pt_spent: 1 });
    const { balance } = await projectPt(new TruthStore(bucket), "voter-2");
    expect(balance).toBe(2); // 3 minted - 1 spent

    const result = (await (await app.request(`/api/v1/gov/disputes/${disputeId}/vote-result`, { headers: voterH }, env)).json()) as {
      buyer_votes: number; seller_votes: number; total_voters: number;
    };
    expect(result.buyer_votes).toBe(1);
    expect(result.seller_votes).toBe(0);
    expect(result.total_voters).toBe(1);
  });

  it("invalid value -> 400", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const disputeId = await publicDispute(bucket, env);
    const voterH = await bearer("voter-3");
    await mintPt(bucket, "voter-3", 5);
    const res = await app.request(`/api/v1/gov/disputes/${disputeId}/votes`, { method: "POST", headers: voterH, body: JSON.stringify({ value: "nope" }) }, env);
    expect(res.status).toBe(400);
  });

  it("a second vote by the same actor -> 409 ALREADY_VOTED (no second PT charge)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const disputeId = await publicDispute(bucket, env);
    const voterH = await bearer("voter-4");
    await mintPt(bucket, "voter-4", 5);
    await app.request(`/api/v1/gov/disputes/${disputeId}/votes`, { method: "POST", headers: voterH, body: JSON.stringify({ value: "seller" }) }, env);
    const second = await app.request(`/api/v1/gov/disputes/${disputeId}/votes`, { method: "POST", headers: voterH, body: JSON.stringify({ value: "buyer" }) }, env);
    expect(second.status).toBe(409);
    const { balance } = await projectPt(new TruthStore(bucket), "voter-4");
    expect(balance).toBe(4); // only 1 PT spent total
  });
});

describe("V3-GOV-07 vote-resolve — VOTING_STILL_OPEN before the 7-day deadline", () => {
  it("voting still open (before 7 days) -> 409 VOTING_STILL_OPEN", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const openerH = await bearer("p-seller");
    const disputeId = await openMarketDispute(env, openerH, "p-buyer");
    await app.request(`/api/v1/gov/disputes/${disputeId}/publicize`, { method: "POST", headers: openerH, body: JSON.stringify({ opener_role: "seller" }) }, env);
    const voterH = await bearer("p-voter");
    await mintPt(bucket, "p-voter", 1);
    await app.request(`/api/v1/gov/disputes/${disputeId}/votes`, { method: "POST", headers: voterH, body: JSON.stringify({ value: "seller" }) }, env);
    const res = await app.request(`/api/v1/gov/disputes/${disputeId}/vote-resolve`, { method: "POST", headers: await bearer("anyone") }, env);
    expect(res.status).toBe(409);
  });
});

describe("V3-GOV-07 projectDisputeVoteTally (pure function・window_closed/winner 判定)", () => {
  it("majority determines winner only once window_closed", async () => {
    const { projectDisputeVoteTally } = await import("../apps/api/src/gov-routes");
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    // seed 2 seller votes + 1 buyer vote directly (bypassing PT gate, pure projection test)
    const seed = async (disputeId: string, actorId: string, value: string) => {
      const id = ulid();
      await s.putEventAt(`truth/ihl.gov.vote.v1/${disputeId}/${actorId}.json`, {
        specversion: "1.0", id, source: "apps/api", type: "ihl.gov.vote.v1",
        time: "2026-01-01T00:00:00Z", dataschema: "schemas/events/gov-vote.schema.json",
        provenance: { generator_kind: "human", actor_id: actorId },
        data: { vote_id: id, actor_id: actorId, kind: "dispute_verdict", proposal_target: disputeId, value, created_at: "2026-01-01T00:00:00Z", schema_version: "1" },
      });
    };
    await seed("D1", "a", "seller");
    await seed("D1", "b", "seller");
    await seed("D1", "c", "buyer");

    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const stillOpen = await projectDisputeVoteTally(s, "D1", future);
    expect(stillOpen.window_closed).toBe(false);
    expect(stillOpen.winner).toBeNull();
    expect(stillOpen.seller_votes).toBe(2);
    expect(stillOpen.buyer_votes).toBe(1);

    const closed = await projectDisputeVoteTally(s, "D1", past); // deadline already elapsed
    expect(closed.window_closed).toBe(true);
    expect(closed.winner).toBe("seller");
  });

  it("tie -> winner 'tie'", async () => {
    const { projectDisputeVoteTally } = await import("../apps/api/src/gov-routes");
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    const seed = async (disputeId: string, actorId: string, value: string) => {
      const id = ulid();
      await s.putEventAt(`truth/ihl.gov.vote.v1/${disputeId}/${actorId}.json`, {
        specversion: "1.0", id, source: "apps/api", type: "ihl.gov.vote.v1",
        time: "2026-01-01T00:00:00Z", dataschema: "schemas/events/gov-vote.schema.json",
        provenance: { generator_kind: "human", actor_id: actorId },
        data: { vote_id: id, actor_id: actorId, kind: "dispute_verdict", proposal_target: disputeId, value, created_at: "2026-01-01T00:00:00Z", schema_version: "1" },
      });
    };
    await seed("D2", "a", "seller");
    await seed("D2", "b", "buyer");
    const closed = await projectDisputeVoteTally(s, "D2", "2020-01-01T00:00:00Z");
    expect(closed.winner).toBe("tie");
  });
});

describe("V3-GOV-07 vote-resolve end-to-end (fake timers: publicize -> vote -> +8 days -> resolve)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves after the window closes: loser gets Δcount+5 once, precedent is recorded, idempotent", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const s = new TruthStore(bucket);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    const openerH = await bearer("e2e-seller");
    const disputeId = await openMarketDispute(env, openerH, "e2e-buyer");
    await app.request(`/api/v1/gov/disputes/${disputeId}/publicize`, { method: "POST", headers: openerH, body: JSON.stringify({ opener_role: "seller" }) }, env);

    // 2 buyer votes vs 1 seller vote -> buyer wins -> loser = seller role = opener (e2e-seller)
    await mintPt(bucket, "e2e-va", 1);
    await mintPt(bucket, "e2e-vb", 1);
    await mintPt(bucket, "e2e-vc", 1);
    await app.request(`/api/v1/gov/disputes/${disputeId}/votes`, { method: "POST", headers: await bearer("e2e-va"), body: JSON.stringify({ value: "buyer" }) }, env);
    await app.request(`/api/v1/gov/disputes/${disputeId}/votes`, { method: "POST", headers: await bearer("e2e-vb"), body: JSON.stringify({ value: "buyer" }) }, env);
    await app.request(`/api/v1/gov/disputes/${disputeId}/votes`, { method: "POST", headers: await bearer("e2e-vc"), body: JSON.stringify({ value: "seller" }) }, env);

    // still within the 7-day window -> resolve refuses.
    const tooEarly = await app.request(`/api/v1/gov/disputes/${disputeId}/vote-resolve`, { method: "POST", headers: await bearer("anyone") }, env);
    expect(tooEarly.status).toBe(409);

    vi.setSystemTime(new Date("2026-01-09T00:00:00Z")); // +8 days: window closed

    const before = await projectLedger(s, "e2e-seller");
    const resolve = await app.request(`/api/v1/gov/disputes/${disputeId}/vote-resolve`, { method: "POST", headers: await bearer("anyone") }, env);
    expect(resolve.status).toBe(201);
    const body = (await resolve.json()) as { winner: string; resolved: boolean };
    expect(body.winner).toBe("buyer");

    const after = await projectLedger(s, "e2e-seller"); // opener_role=seller lost -> opener is the loser
    expect(after.karma_count).toBe(before.karma_count + 5);

    // idempotent: a second resolve call does NOT re-apply the karma penalty.
    const secondResolve = await app.request(`/api/v1/gov/disputes/${disputeId}/vote-resolve`, { method: "POST", headers: await bearer("anyone") }, env);
    expect(secondResolve.status).toBe(200);
    const afterTwice = await projectLedger(s, "e2e-seller");
    expect(afterTwice.karma_count).toBe(after.karma_count); // unchanged

    // precedent recorded
    const precedents = (await (await app.request(`/api/v1/gov/precedents?q=${disputeId}`, { headers: await bearer("anyone") }, env)).json()) as {
      precedents: { dispute_id: string }[];
    };
    expect(precedents.precedents.some((p) => p.dispute_id === disputeId)).toBe(true);
  });

  it("tie -> no karma change for either participant", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const s = new TruthStore(bucket);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));

    const openerH = await bearer("tie-seller");
    const disputeId = await openMarketDispute(env, openerH, "tie-buyer");
    await app.request(`/api/v1/gov/disputes/${disputeId}/publicize`, { method: "POST", headers: openerH, body: JSON.stringify({ opener_role: "seller" }) }, env);
    await mintPt(bucket, "tie-va", 1);
    await mintPt(bucket, "tie-vb", 1);
    await app.request(`/api/v1/gov/disputes/${disputeId}/votes`, { method: "POST", headers: await bearer("tie-va"), body: JSON.stringify({ value: "seller" }) }, env);
    await app.request(`/api/v1/gov/disputes/${disputeId}/votes`, { method: "POST", headers: await bearer("tie-vb"), body: JSON.stringify({ value: "buyer" }) }, env);

    vi.setSystemTime(new Date("2026-02-09T00:00:00Z")); // +8 days: window closed

    const sellerBefore = await projectLedger(s, "tie-seller");
    const buyerBefore = await projectLedger(s, "tie-buyer");
    const res = await app.request(`/api/v1/gov/disputes/${disputeId}/vote-resolve`, { method: "POST", headers: await bearer("anyone") }, env);
    expect(res.status).toBe(201);
    expect(((await res.json()) as { winner: string }).winner).toBe("tie");
    expect((await projectLedger(s, "tie-seller")).karma_count).toBe(sellerBefore.karma_count);
    expect((await projectLedger(s, "tie-buyer")).karma_count).toBe(buyerBefore.karma_count);
  });
});
