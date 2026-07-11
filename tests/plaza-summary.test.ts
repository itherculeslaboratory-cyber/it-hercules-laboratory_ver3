// Summary TC(design-c5.md §K6 §4 / V3-BBS-10)。block_index=floor(post 通番/SUMMARY_BLOCK_SIZE)・
// projectSummary が4層(post emb 参照 / block emb 参照 / current_summary+open_questions /
// diff 履歴)を返す・要約本文は空スロット許容(LLM 呼び出しゼロ)・summary append で diff が
// 履歴に積まれる。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { ulid } from "@ihl/truth";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

function postSummary(env: ReturnType<typeof makeEnv>, body: Record<string, unknown>) {
  return app.request("/api/v1/plaza/summaries", { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(body) }, env);
}
function getSummary(env: ReturnType<typeof makeEnv>, threadId: string) {
  return app.request(`/api/v1/plaza/threads/${threadId}/summary`, { headers: AUTH_HEADERS }, env);
}

describe("POST /api/v1/plaza/summaries + 4-layer projection (BBS-10)", () => {
  it("computes block_index = floor((post_count-1)/SUMMARY_BLOCK_SIZE) when omitted", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const threadId = ulid(1000);
    await app.request(
      "/api/v1/plaza/posts",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ channel: "c", topic: "t", board_kind: "guide", body: "b", post_id: threadId, thread_id: threadId }) },
      env,
    );
    const created = await postSummary(env, { thread_id: threadId, current_summary: "", generator: "manual" });
    expect(created.status).toBe(201);
    // 1 post -> floor(0/100) = 0
    const { block_index } = (await created.json()) as { block_index: number };
    expect(block_index).toBe(0);
  });

  it("accepts an empty current_summary slot without invoking any LLM", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const threadId = ulid(1000);
    const created = await postSummary(env, { thread_id: threadId, block_index: 0, current_summary: "", generator: "batch" });
    expect(created.status).toBe(201);
    const view = (await (await getSummary(env, threadId)).json()) as { current_summary: string };
    expect(view.current_summary).toBe("");
  });

  it("returns all four layers with embedding references and the latest summary", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const threadId = ulid(1000);
    await postSummary(env, { thread_id: threadId, block_index: 0, current_summary: "first", diff: "d0", generator: "manual" });
    await postSummary(env, { thread_id: threadId, block_index: 1, current_summary: "latest text", open_questions: ["q1"], diff: "d1", generator: "manual" });

    const view = (await (await getSummary(env, threadId)).json()) as {
      post_embedding: { manifest: string; dim: number };
      block_embedding: { manifest: string; dim: number };
      current_summary: string;
      open_questions: string[];
      diff_history: { block_index: number; diff: string }[];
    };
    // layer 1 & 2: embedding references (empty slot, 384-dim CL-08 manifest)
    expect(view.post_embedding.dim).toBe(384);
    expect(view.block_embedding.manifest).toContain("embedding-manifest");
    // layer 3: latest summary + open questions
    expect(view.current_summary).toBe("latest text");
    expect(view.open_questions).toEqual(["q1"]);
    // layer 4: diff history accumulated in block order
    expect(view.diff_history.map((d) => d.diff)).toEqual(["d0", "d1"]);
  });
});

describe("plaza summary route is protected", () => {
  it("returns 401 unauthenticated", async () => {
    const env = makeEnv();
    const r = await app.request("/api/v1/plaza/summaries", { method: "POST", body: "{}" }, env);
    expect(r.status).toBe(401);
  });
});
