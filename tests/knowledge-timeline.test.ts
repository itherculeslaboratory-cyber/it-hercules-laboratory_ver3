// V3-BBS-37 — 議論スレ・intentチェーン・ADR・不採用理由の時系列読み取り専用ビュー。
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { TruthStore, ulid } from "@ihl/truth";
import { appendIntent } from "../apps/api/src/intent";
import { knowledgeTimelineRoutes, projectDecisionTimeline } from "../apps/api/src/knowledge-timeline-routes";
import { FakeR2Bucket, makeEnv } from "./helpers";

const POST_TYPE = "ihl.plaza.post.v1";

async function seedPost(bucket: FakeR2Bucket, postId: string, threadId: string, createdAt: string) {
  await new TruthStore(bucket).putEventAt(`truth/${POST_TYPE}/c/${threadId}/${postId}.json`, {
    specversion: "1.0", id: ulid(), source: "test", type: POST_TYPE, time: createdAt,
    dataschema: "schemas/events/plaza-post.schema.json",
    provenance: { generator_kind: "human", actor_id: "dev" },
    data: { post_id: postId, actor_id: "dev", channel: "c", thread_id: threadId, topic: "t", board_kind: "guide", body: `body-${postId}`, created_at: createdAt, schema_version: "1" },
  });
}

const app = new Hono<{ Bindings: ReturnType<typeof makeEnv> }>();
app.route("/api/v1", knowledgeTimelineRoutes);

describe("V3-BBS-37 decision timeline", () => {
  it("projectDecisionTimeline merges intent (with rejected_alternatives) and thread posts, sorted by time", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    const rootId = ulid(1000);
    await seedPost(bucket, rootId, rootId, "2026-07-01T00:00:00.000Z");

    const intentId = ulid(500); // earlier than the post
    await appendIntent(s, "dev", {
      intent_id: intentId,
      spec_version: "v1",
      intent_summary: "3柱ハブ設計",
      problem_statement: "掲示板/論文/GitHubが分断",
      expected_effect: "統合ハブで導線を1本化",
      created_at: "2026-06-30T00:00:00.000Z",
      schema_version: "1",
      rejected_alternatives: ["タブ構成案"],
      decision_source: "docs/planning/c5/design-c5.md",
      post_id: rootId,
    });

    const timeline = await projectDecisionTimeline(s, rootId);
    expect(timeline.map((t) => t.kind)).toEqual(["intent", "post"]);
    expect(timeline[0].rejected_alternatives).toEqual(["タブ構成案"]);
    expect(timeline[1].summary).toContain(rootId);
  });

  it("GET /knowledge/timeline/:ref returns an empty timeline for an unknown ref (honest empty state)", async () => {
    const res = await app.request("/api/v1/knowledge/timeline/NOPE", {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ref: string; timeline: unknown[] };
    expect(body.ref).toBe("NOPE");
    expect(body.timeline).toEqual([]);
  });

  it("GET /knowledge/timeline/:ref surfaces intent events by post_id via the route", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    const rootId = ulid(1000);
    await seedPost(bucket, rootId, rootId, "2026-07-01T00:00:00.000Z");
    await appendIntent(s, "dev", {
      intent_id: ulid(),
      spec_version: "v1",
      intent_summary: "s",
      problem_statement: "p",
      expected_effect: "e",
      created_at: "2026-06-30T00:00:00.000Z",
      schema_version: "1",
      post_id: rootId,
    });
    const res = await app.request(`/api/v1/knowledge/timeline/${rootId}`, {}, makeEnv(bucket));
    const body = (await res.json()) as { timeline: { kind: string }[] };
    expect(body.timeline.some((t) => t.kind === "intent")).toBe(true);
    expect(body.timeline.some((t) => t.kind === "post")).toBe(true);
  });
});
