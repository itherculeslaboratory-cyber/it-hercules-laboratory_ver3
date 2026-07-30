// V3-BBS-16 — 開発掲示板のコード機能単位(モジュール)channel索引。
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { TruthStore, ulid } from "@ihl/truth";
import {
  buildFileBoardRegistry,
  classifyFileBoardLayer,
  fileBoardChannel,
  plazaFileBoardRoutes,
} from "../apps/api/src/plaza-file-board-registry";
import { FakeR2Bucket, makeEnv } from "./helpers";

const app = new Hono<{ Bindings: ReturnType<typeof makeEnv> }>();
app.route("/api/v1", plazaFileBoardRoutes);

describe("V3-BBS-16 file board registry", () => {
  it("classifies *-routes/*-connector/*-webhook as P (ファイル連携)", () => {
    expect(classifyFileBoardLayer("plaza-routes")).toBe("P");
    expect(classifyFileBoardLayer("payjp-connector")).toBe("P");
    expect(classifyFileBoardLayer("gmo-webhook")).toBe("V"); // 明示 V 層リスト優先
  });

  it("classifies plain modules as B (柔軟設計)", () => {
    expect(classifyFileBoardLayer("plaza-constants")).toBe("B");
  });

  it("classifies explicit release/ops modules as V", () => {
    expect(classifyFileBoardLayer("batch")).toBe("V");
    expect(classifyFileBoardLayer("costs-routes")).toBe("V");
  });

  it("buildFileBoardRegistry returns a sorted, deterministic entry per known module", () => {
    const registry = buildFileBoardRegistry(["plaza-routes", "batch", "plaza-constants"]);
    expect(registry).toEqual([
      { module: "batch", layer: "V", channel: "dev:batch" },
      { module: "plaza-constants", layer: "B", channel: "dev:plaza-constants" },
      { module: "plaza-routes", layer: "P", channel: "dev:plaza-routes" },
    ]);
  });

  it("GET /plaza/file-board/registry returns the full known-module index", async () => {
    const res = await app.request("/api/v1/plaza/file-board/registry", {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { registry: { module: string }[] };
    expect(body.registry.length).toBeGreaterThan(50);
    expect(body.registry.some((e) => e.module === "plaza-routes")).toBe(true);
  });

  it("GET /plaza/file-board/:module/threads reuses projectChannelThreads on the dev:<module> channel", async () => {
    const bucket = new FakeR2Bucket();
    const POST_TYPE = "ihl.plaza.post.v1";
    const channel = fileBoardChannel("plaza-routes");
    const postId = ulid();
    await new TruthStore(bucket).putEventAt(`truth/${POST_TYPE}/${channel}/${postId}/${postId}.json`, {
      specversion: "1.0", id: ulid(), source: "test", type: POST_TYPE, time: new Date().toISOString(),
      dataschema: "schemas/events/plaza-post.schema.json",
      provenance: { generator_kind: "human", actor_id: "dev" },
      data: { post_id: postId, actor_id: "dev", channel, thread_id: postId, topic: "t", board_kind: "guide", body: "b", created_at: new Date().toISOString(), schema_version: "1" },
    });
    const res = await app.request(`/api/v1/plaza/file-board/plaza-routes/threads`, {}, makeEnv(bucket));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { channel: string; threads: { thread_id: string }[] };
    expect(body.channel).toBe(channel);
    expect(body.threads.map((t) => t.thread_id)).toContain(postId);
  });
});
