// V3-BBS-33 — 掲示板統計(ローカル vs 文明全体)の分離投影。
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { plazaStatsRoutes } from "../apps/api/src/plaza-stats-routes";
import { plazaRoutes } from "../apps/api/src/plaza-routes";
import { makeEnv } from "./helpers";

function appAs(actorId: string) {
  const app = new Hono<{ Bindings: ReturnType<typeof makeEnv>; Variables: { actorId: string } }>();
  app.use("*", async (c, next) => { c.set("actorId", actorId); await next(); });
  app.route("/api/v1", plazaRoutes);
  app.route("/api/v1", plazaStatsRoutes);
  return app;
}
function post(app: Hono, path: string, body: Record<string, unknown>, env: unknown) {
  return app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, env);
}

describe("V3-BBS-33 board vs global stats separation", () => {
  it("board stats only reflect the queried channel; global stats aggregate across channels", async () => {
    const env = makeEnv();
    const app = appAs("alice");
    await post(app, "/api/v1/plaza/posts", { channel: "board-a", board_kind: "guide", topic: "t1", body: "b", tags: ["breed"] }, env);
    await post(app, "/api/v1/plaza/posts", { channel: "board-a", board_kind: "guide", topic: "t2", body: "b", tags: ["breed"] }, env);
    await post(app, "/api/v1/plaza/posts", { channel: "board-b", board_kind: "guide", topic: "t3", body: "b", tags: ["care"] }, env);

    const boardA = (await (await app.request("/api/v1/plaza/stats/board/board-a", {}, env)).json()) as { post_count: number; tag_frequency: Record<string, number> };
    expect(boardA.post_count).toBe(2);
    expect(boardA.tag_frequency.breed).toBe(2);
    expect(boardA.tag_frequency.care).toBeUndefined();

    const global = (await (await app.request("/api/v1/plaza/stats/global", {}, env)).json()) as {
      post_count: number; board_count: number; posts_by_channel: Record<string, number>;
    };
    expect(global.post_count).toBe(3);
    expect(global.board_count).toBe(2);
    expect(global.posts_by_channel["board-a"]).toBe(2);
    expect(global.posts_by_channel["board-b"]).toBe(1);
  });

  it("active_user_count counts distinct posters", async () => {
    const env = makeEnv();
    const alice = appAs("alice");
    const bob = appAs("bob");
    await post(alice, "/api/v1/plaza/posts", { channel: "board-c", board_kind: "guide", topic: "t1", body: "b" }, env);
    await post(bob, "/api/v1/plaza/posts", { channel: "board-c", board_kind: "guide", topic: "t2", body: "b" }, env);
    await post(alice, "/api/v1/plaza/posts", { channel: "board-c", board_kind: "guide", topic: "t3", body: "b" }, env);
    const stats = (await (await alice.request("/api/v1/plaza/stats/board/board-c", {}, env)).json()) as { active_user_count: number };
    expect(stats.active_user_count).toBe(2);
  });

  it("empty channel returns zeroed stats (not an error)", async () => {
    const env = makeEnv();
    const app = appAs("alice");
    const res = await app.request("/api/v1/plaza/stats/board/no-such-channel", {}, env);
    expect(res.status).toBe(200);
    expect((await res.json()) as { post_count: number; ai_generation_rate: number }).toMatchObject({
      post_count: 0,
      active_user_count: 0,
      ai_generation_rate: 0,
    });
  });

  // w3-plaza(第3波持ち越し・62代目HQ検収是正R0731-dcff50): 「AI生成率」統計を tags[]
  // 規約(AI_ASSISTED_TAG="ai_assisted")で計測する。
  it("ai_generation_rate = ai_assisted タグ付き投稿の割合(未対応クライアントは0%)", async () => {
    const env = makeEnv();
    const app = appAs("alice");
    await post(app, "/api/v1/plaza/posts", { channel: "board-d", board_kind: "guide", topic: "t1", body: "b", tags: ["ai_assisted"] }, env);
    await post(app, "/api/v1/plaza/posts", { channel: "board-d", board_kind: "guide", topic: "t2", body: "b" }, env);
    await post(app, "/api/v1/plaza/posts", { channel: "board-d", board_kind: "guide", topic: "t3", body: "b" }, env);
    const stats = (await (await app.request("/api/v1/plaza/stats/board/board-d", {}, env)).json()) as { ai_generation_rate: number };
    expect(stats.ai_generation_rate).toBeCloseTo(1 / 3);
  });
});
