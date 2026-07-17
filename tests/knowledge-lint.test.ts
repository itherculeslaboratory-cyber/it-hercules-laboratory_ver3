// V3-WIK-07 — 月次Lint(矛盾・孤立ページ・古い記述・リンク切れ)を実行し既存 WIK-01
// wiki_node(level=lint_log)へ log.md 形式で記録する。実行は手動 route のみ(常駐なし)・
// 月次スケジューリング(cron)は既存 check-cron GATE と同じく人間ゲート。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, ulid } from "@ihl/truth";
import { runMonthlyLint } from "../apps/api/src/knowledge-lint";
import { renderLintLogMarkdown } from "../apps/api/src/knowledge-lint-routes";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

function post(env: ReturnType<typeof makeEnv>, path: string, body: unknown) {
  return app.request(`/api/v1${path}`, { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(body) }, env);
}

describe("runMonthlyLint", () => {
  it("flags an orphan paper (no incoming/outgoing references; a fork always has forked_from, so it can never be orphan)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const s = new TruthStore(bucket);
    await post(env, "/research/content", {
      content_id: "LONELY-PAPER", content_type: "paper", title: "lonely paper",
      sections: { purpose: { filled: true, text: "x" }, hypothesis: { filled: false, text: "" }, conditions: { filled: false, text: "" }, verification: { filled: false, text: "" }, phase: { filled: false, text: "" }, gap: { filled: false, text: "" } },
      completeness_pct: 17,
    });
    const report = await runMonthlyLint(s, new Date("2026-07-17T00:00:00Z"));
    expect(report.findings.some((f) => f.kind === "orphan" && f.detail.includes("lonely paper"))).toBe(true);
  });

  it("flags a broken_link for a cite_ref target that does not resolve", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const s = new TruthStore(bucket);
    const rootId = ulid(1000);
    await post(env, "/plaza/posts", {
      channel: "ch", topic: "t", board_kind: "guide", post_id: rootId, thread_id: rootId,
      body: "x", cite_refs: [{ type: "post", id: "MISSING-POST" }],
    });
    const report = await runMonthlyLint(s, new Date("2026-07-17T00:00:00Z"));
    expect(report.findings).toContainEqual({ kind: "broken_link", id: rootId, detail: "cite post:MISSING-POST does not resolve" });
  });

  it("flags stale content older than STALE_DAYS(180) but not recent content", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const s = new TruthStore(bucket);
    const oldId = ulid(1000);
    const freshId = ulid(2000);
    // POST /plaza/posts always stamps created_at=now server-side, so write the old post's
    // created_at directly via TruthStore to make it deterministically stale.
    await s.putEventAt(`truth/ihl.plaza.post.v1/ch/${oldId}/${oldId}.json`, {
      specversion: "1.0", id: oldId, source: "apps/api", type: "ihl.plaza.post.v1",
      time: "2020-01-01T00:00:00Z", dataschema: "schemas/events/plaza-post.schema.json",
      provenance: { generator_kind: "human", actor_id: "u1" },
      data: {
        post_id: oldId, actor_id: "u1", channel: "ch", topic: "old", board_kind: "guide",
        thread_id: oldId, body: "x", created_at: "2020-01-01T00:00:00Z", schema_version: "1",
      },
    });
    await post(env, "/plaza/posts", { channel: "ch", topic: "fresh", board_kind: "guide", post_id: freshId, thread_id: freshId, body: "x" });
    const report = await runMonthlyLint(s, new Date("2026-07-17T00:00:00Z"));
    expect(report.findings.some((f) => f.kind === "stale" && f.id === oldId)).toBe(true);
    expect(report.findings.some((f) => f.kind === "stale" && f.id === freshId)).toBe(false);
  });

  it("flags contradiction for a divisive thread (BBS-36 projectConsensus reused)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const s = new TruthStore(bucket);
    const rootId = ulid(1000);
    await post(env, "/plaza/posts", { channel: "ch", topic: "debate", board_kind: "guide", post_id: rootId, thread_id: rootId, body: "x" });
    // 5 distinct actors, 3 agree / 2 disagree -> min(3,2)/5=0.4 >= DIVISIVE_MIN_SIDE_RATIO(0.3)
    // and total(5) >= CONSENSUS_MIN_VOTES(5) -> divisive=true. Written directly via TruthStore
    // (HTTP layer always uses the single session principal, so distinct actors need direct writes).
    const values = ["agree", "agree", "agree", "disagree", "disagree"];
    for (const [i, value] of values.entries()) {
      const stanceId = ulid(2000 + i);
      await s.putEventAt(`truth/ihl.plaza.stance.v1/${rootId}/${stanceId}.json`, {
        specversion: "1.0", id: stanceId, source: "apps/api", type: "ihl.plaza.stance.v1",
        time: "2026-07-01T00:00:00Z", dataschema: "schemas/events/plaza-stance.schema.json",
        provenance: { generator_kind: "human", actor_id: `actor-${i}` },
        data: { stance_id: stanceId, actor_id: `actor-${i}`, statement_id: rootId, value, created_at: "2026-07-01T00:00:00Z", schema_version: "1" },
      });
    }
    const report = await runMonthlyLint(s, new Date("2026-07-17T00:00:00Z"));
    expect(report.findings.some((f) => f.kind === "contradiction" && f.id === rootId)).toBe(true);
  });
});

describe("renderLintLogMarkdown", () => {
  it("groups findings by kind under a heading, in a fixed kind order", () => {
    const md = renderLintLogMarkdown({
      run_at: "2026-07-17T00:00:00Z",
      findings: [{ kind: "orphan", id: "X1", detail: "lonely" }, { kind: "stale", id: "X2", detail: "old" }],
    });
    expect(md).toContain("## contradiction (0)");
    expect(md.indexOf("## orphan")).toBeLessThan(md.indexOf("## stale"));
    expect(md).toContain("- X1: lonely");
  });
});

describe("POST /api/v1/wiki/lint + GET /api/v1/wiki/lint-log", () => {
  it("runs a lint pass, appends a lint_log wiki_node, and surfaces it in history", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const run = await post(env, "/wiki/lint", {});
    expect(run.status).toBe(200);
    const runBody = (await run.json()) as { node_id: string; findings: unknown[] };
    expect(typeof runBody.node_id).toBe("string");

    const history = await app.request("/api/v1/wiki/lint-log", { headers: AUTH_HEADERS }, env);
    expect(history.status).toBe(200);
    const { runs } = (await history.json()) as { runs: { node_id: string; level: string }[] };
    expect(runs.some((r) => r.node_id === runBody.node_id && r.level === "lint_log")).toBe(true);
  });

  it("requires auth (401)", async () => {
    const res1 = await app.request("/api/v1/wiki/lint", { method: "POST" }, makeEnv());
    expect(res1.status).toBe(401);
    const res2 = await app.request("/api/v1/wiki/lint-log", {}, makeEnv());
    expect(res2.status).toBe(401);
  });
});
