// MKT-22 テンプレマーケット。ランキングは RANKING_WEIGHTS(40/20/20/10/10)重み付き
// 合計、fork は forked_from で系譜連結し fork グラフから forks を導出。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import {
  rankingScore,
  rankTemplates,
} from "../apps/api/src/market-template-routes";
import { RANKING_WEIGHTS } from "../apps/api/src/economy-constants";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

describe("MKT-22 rankingScore 重み 40/20/20/10/10", () => {
  it("各指標へ正しい重みを掛ける", () => {
    expect(rankingScore({ usage: 1 })).toBe(40);
    expect(rankingScore({ retention: 1 })).toBe(20);
    expect(rankingScore({ rating: 1 })).toBe(20);
    expect(rankingScore({ forks: 1 })).toBe(10);
    expect(rankingScore({ improvements: 1 })).toBe(10);
    expect(rankingScore({ usage: 1, retention: 1, rating: 1, forks: 1, improvements: 1 })).toBe(100);
  });
  it("重み定数は凍結スナップショット", () => {
    expect(RANKING_WEIGHTS).toEqual({ usage: 40, retention: 20, rating: 20, forks: 10, improvements: 10 });
  });
});

describe("MKT-22 rankTemplates fork グラフ由来 forks + 降順整列", () => {
  it("fork の多いテンプレが上位・forked_from で系譜連結", () => {
    const templates = [
      { template_id: "T1", actor_id: "a", kind: "paper", title: "base" },
      { template_id: "T2", actor_id: "b", kind: "paper", title: "fork1", forked_from: "T1" },
      { template_id: "T3", actor_id: "c", kind: "paper", title: "fork2", forked_from: "T1" },
      { template_id: "T4", actor_id: "d", kind: "prompt", title: "lonely" },
    ];
    const ranked = rankTemplates(templates);
    expect(ranked[0].template_id).toBe("T1"); // 2 fork = score 20 で最上位
    expect(ranked[0].fork_count).toBe(2);
    expect(ranked[0].score).toBe(20);
    const t2 = ranked.find((r) => r.template_id === "T2");
    expect(t2?.forked_from).toBe("T1");
    expect(t2?.fork_count).toBe(0);
  });
});

describe("template routes", () => {
  it("POST /market/templates: kind 不正/title 欠如は 400", async () => {
    const r1 = await app.request(
      "/api/v1/market/templates",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ kind: "bogus", title: "x" }) },
      makeEnv(),
    );
    expect(r1.status).toBe(400);
    const r2 = await app.request(
      "/api/v1/market/templates",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ kind: "paper" }) },
      makeEnv(),
    );
    expect(r2.status).toBe(400);
  });

  it("出品 → fork → GET でランキング・fork_count 反映", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const created = await app.request(
      "/api/v1/market/templates",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ kind: "paper", title: "base paper" }) },
      env,
    );
    expect(created.status).toBe(201);
    const parentId = ((await created.json()) as { template_id: string }).template_id;

    const forked = await app.request(
      `/api/v1/market/templates/${parentId}/fork`,
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ title: "my fork" }) },
      env,
    );
    expect(forked.status).toBe(201);
    expect(((await forked.json()) as { forked_from: string }).forked_from).toBe(parentId);

    const list = await app.request("/api/v1/market/templates", { headers: AUTH_HEADERS }, env);
    const { templates } = (await list.json()) as {
      templates: { template_id: string; fork_count: number; score: number; forked_from?: string }[];
    };
    expect(templates.length).toBe(2);
    expect(templates[0].template_id).toBe(parentId); // fork 1 = 上位
    expect(templates[0].fork_count).toBe(1);
    expect(templates[0].score).toBe(10);
  });

  it("存在しない親への fork は 404", async () => {
    const res = await app.request(
      "/api/v1/market/templates/NOPE/fork",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({}) },
      makeEnv(),
    );
    expect(res.status).toBe(404);
  });
});
