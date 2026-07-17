// V3-BBS-28 Engagement(公開Q&A・称賛・未出品オファー・一括募集)。掲示板側の募集スレ型に
// 限定(board_kind=engagement)・市場のオファー機構(V3-MKT-06)とは非衝突。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, ulid } from "@ihl/truth";
import { classifyEngagementQuestion } from "../apps/api/src/engagement-routes";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

const CHANNEL = "engagement-board";
const CAPTURE_TYPE = "ihl.obs.capture.v1";

function post(env: ReturnType<typeof makeEnv>, body: unknown) {
  return app.request("/api/v1/plaza/posts", { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(body) }, env);
}

describe("classifyEngagementQuestion (deterministic keyword classifier)", () => {
  it("classifies a care/husbandry question", () => {
    expect(classifyEngagementQuestion("マットの温度と湿度はどれくらいですか")).toBe("care");
  });
  it("classifies a meaningless/low-value question", () => {
    expect(classifyEngagementQuestion("age www")).toBe("meaningless");
  });
  it("falls back to beginner when nothing matches", () => {
    expect(classifyEngagementQuestion("これは何ですか")).toBe("beginner");
  });
});

describe("POST /api/v1/plaza/posts board_kind=engagement", () => {
  it("accepts an engagement post (qna subtype via tags)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const res = await post(env, {
      channel: CHANNEL, topic: "質問", board_kind: "engagement", body: "温度は何度ですか", tags: ["engagement:qna"],
    });
    expect(res.status).toBe(201);
  });
});

describe("GET /api/v1/plaza/engagement/insights", () => {
  it("returns predicted_questions ranked by frequency with auto classification", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const q1 = "温度は何度ですか";
    await post(env, { channel: CHANNEL, topic: "質問1", board_kind: "engagement", post_id: ulid(1000), thread_id: ulid(1000), body: q1, tags: ["engagement:qna"] });
    await post(env, { channel: CHANNEL, topic: "質問2", board_kind: "engagement", post_id: ulid(2000), thread_id: ulid(2000), body: q1, tags: ["engagement:qna"] });
    await post(env, { channel: CHANNEL, topic: "質問3", board_kind: "engagement", post_id: ulid(3000), thread_id: ulid(3000), body: "血統はどこ産ですか", tags: ["engagement:qna"] });
    // non-qna engagement post must not pollute predicted questions
    await post(env, { channel: CHANNEL, topic: "称賛", board_kind: "engagement", post_id: ulid(4000), thread_id: ulid(4000), body: "すごい個体ですね", tags: ["engagement:praise"] });

    const res = await app.request(`/api/v1/plaza/engagement/insights?channel=${CHANNEL}`, { headers: AUTH_HEADERS }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { predicted_questions: { body: string; count: number; category: string }[] };
    expect(body.predicted_questions[0]).toMatchObject({ body: q1, count: 2 });
    expect(body.predicted_questions.some((p) => p.body === "血統はどこ産ですか" && p.category === "lineage")).toBe(true);
    expect(body.predicted_questions.some((p) => p.body === "すごい個体ですね")).toBe(false);
  });

  it("returns praise_points derived from stable observation measurements for a subject_ref", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const s = new TruthStore(bucket);
    const subjectRef = "individual/IND-1";
    for (const [i, v] of [10.0, 10.1, 9.9].entries()) {
      const id = ulid(1000 + i);
      const res = await s.putEvent({
        specversion: "1.0", id, source: "apps/api", type: CAPTURE_TYPE, time: "2026-07-11T00:00:00Z",
        dataschema: "schemas/events/obs-capture.schema.json",
        provenance: { generator_kind: "human", actor_id: "u1" },
        data: {
          capture_id: id, actor_id: "u1", domain: "biology", subject_ref: subjectRef,
          measurements: [{ item: "horn_angle", kind: "number", value: v, value_origin: "direct_observed" }],
        },
      });
      if (res.status !== "inserted") throw new Error(`seed capture failed: ${res.status}`);
    }
    const res = await app.request(`/api/v1/plaza/engagement/insights?subject_ref=${encodeURIComponent(subjectRef)}`, { headers: AUTH_HEADERS }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { praise_points: { item: string; message: string }[] };
    expect(body.praise_points.some((p) => p.item === "horn_angle")).toBe(true);
  });

  it("omits keys for query params not supplied", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const res = await app.request(`/api/v1/plaza/engagement/insights`, { headers: AUTH_HEADERS }, env);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({});
  });
});
