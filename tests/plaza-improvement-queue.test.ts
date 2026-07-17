// V3-BBS-14 — 改善要求 voteable(積み投票/プラチナコイン)+ AI 安全チェック + 優先度キュー。
// 投票基盤は既存プラチナ投票(KRM-25・POST /social/platinum-votes・GOV-07/MKT-35 と同一方式)を
// 再利用する(新規投票機構は作らない)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { deriveActorId, ulid } from "@ihl/truth";
import { isOffensiveContent } from "../apps/api/src/plaza-routes";
import { grantPlatinum } from "../apps/api/src/ledger-routes";
import { TruthStore } from "@ihl/truth";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

const DEV_ACTOR = await deriveActorId("dev@ihl.local");
const CHANNEL = "improvement-board";

function post(env: ReturnType<typeof makeEnv>, body: unknown) {
  return app.request("/api/v1/plaza/posts", { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(body) }, env);
}
function vote(env: ReturnType<typeof makeEnv>, targetId: string, coins: number) {
  return app.request(
    "/api/v1/social/platinum-votes",
    { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ target_id: targetId, coins }) },
    env,
  );
}

describe("isOffensiveContent (deterministic keyword blocklist fallback)", () => {
  it("flags a blocked term case-insensitively", () => {
    expect(isOffensiveContent("I will KILL YOU")).toBe(true);
  });
  it("passes ordinary text", () => {
    expect(isOffensiveContent("please add dark mode")).toBe(false);
  });
});

describe("POST /api/v1/plaza/posts board_kind=improvement AI safety check", () => {
  it("rejects offensive content with 400 AI_SAFETY_REJECTED", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const res = await post(env, {
      channel: CHANNEL, topic: "改善要求", board_kind: "improvement", body: "die you all",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("AI_SAFETY_REJECTED");
  });

  it("accepts ordinary improvement requests", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const res = await post(env, {
      channel: CHANNEL, topic: "改善要求", board_kind: "improvement", body: "dark mode please",
    });
    expect(res.status).toBe(201);
  });
});

describe("GET /api/v1/plaza/channels/{channel}/improvement-queue", () => {
  it("sorts improvement threads by accumulated platinum-coin votes (descending)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const rootA = ulid(1000);
    const rootB = ulid(2000);
    await post(env, { channel: CHANNEL, topic: "A案", board_kind: "improvement", post_id: rootA, thread_id: rootA, body: "A" });
    await post(env, { channel: CHANNEL, topic: "B案", board_kind: "improvement", post_id: rootB, thread_id: rootB, body: "B" });

    const s = new TruthStore(bucket);
    await grantPlatinum(s, DEV_ACTOR, 20);
    await vote(env, rootB, 15); // B gets more votes than A
    await vote(env, rootA, 3);

    const res = await app.request(`/api/v1/plaza/channels/${CHANNEL}/improvement-queue`, { headers: AUTH_HEADERS }, env);
    expect(res.status).toBe(200);
    const { queue } = (await res.json()) as { queue: { thread_id: string; votes: number; official: boolean }[] };
    expect(queue.map((q) => q.thread_id)).toEqual([rootB, rootA]);
    expect(queue[0].votes).toBe(15);
    expect(queue[0].official).toBe(false); // 15 < default threshold 100
  });

  it("flags official=true (and notify_admin) once the vote threshold (100) is reached", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const rootId = ulid();
    await post(env, { channel: CHANNEL, topic: "人気の改善案", board_kind: "improvement", post_id: rootId, thread_id: rootId, body: "x" });
    const s = new TruthStore(bucket);
    await grantPlatinum(s, DEV_ACTOR, 100);
    await vote(env, rootId, 100);

    const res = await app.request(`/api/v1/plaza/channels/${CHANNEL}/improvement-queue`, { headers: AUTH_HEADERS }, env);
    const { queue } = (await res.json()) as { queue: { official: boolean; notify_admin: boolean; official_threshold: number }[] };
    expect(queue[0].official).toBe(true);
    expect(queue[0].notify_admin).toBe(true);
    expect(queue[0].official_threshold).toBe(100);
  });

  it("only includes board_kind=improvement threads, not guide/complaint", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const guideId = ulid();
    await post(env, { channel: CHANNEL, topic: "使い方", board_kind: "guide", post_id: guideId, thread_id: guideId, body: "x" });
    const res = await app.request(`/api/v1/plaza/channels/${CHANNEL}/improvement-queue`, { headers: AUTH_HEADERS }, env);
    const { queue } = (await res.json()) as { queue: unknown[] };
    expect(queue).toEqual([]);
  });
});
