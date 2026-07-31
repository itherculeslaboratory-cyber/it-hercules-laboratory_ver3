// R0731 w2-plaza: BBS-02(論文板case)・BBS-11(作成前検索誘導)・BBS-12(AI補助たたき台)・
// BBS-25(統一ノードビュー)。plaza-routes.ts は既に index.ts へ mount 済みのため
// full app(apps/api/src/index)経由でテストする(plaza-fork.test.ts と同型)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { draftBoardFromText, appendCitationLink } from "../apps/api/src/plaza-routes";
import { TruthStore } from "@ihl/truth";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv, makeEnvelope } from "./helpers";

function postJson(env: ReturnType<typeof makeEnv>, path: string, body: Record<string, unknown>) {
  return app.request(path, { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(body) }, env);
}
function post(overrides: Record<string, unknown>) {
  return { channel: "c", board_kind: "guide", topic: "t", body: "本文", ...overrides };
}

describe("V3-BBS-02 paper board case (tags[] prefix — plaza-post.schema.json は凍結enumのため board_kind ではなく tags[] で表現)", () => {
  it("rejects an invalid paper_case", async () => {
    const env = makeEnv();
    const res = await postJson(env, "/api/v1/plaza/posts", post({ channel: "c-bbs02", paper_case: "not_a_case" }));
    expect(res.status).toBe(400);
  });

  it("accepts a valid paper_case and filters channel threads by ?case=", async () => {
    const env = makeEnv();
    const a = (await (await postJson(env, "/api/v1/plaza/posts", post({ channel: "c-bbs02", topic: "obs-thread", paper_case: "observation" }))).json()) as {
      post_id: string;
    };
    const b = (await (await postJson(env, "/api/v1/plaza/posts", post({ channel: "c-bbs02", topic: "review-thread", paper_case: "review" }))).json()) as {
      post_id: string;
    };

    const filtered = (await (await app.request("/api/v1/plaza/channels/c-bbs02/threads?case=observation", { headers: AUTH_HEADERS }, env)).json()) as {
      threads: { thread_id: string }[];
    };
    expect(filtered.threads.some((t) => t.thread_id === a.post_id)).toBe(true);
    expect(filtered.threads.some((t) => t.thread_id === b.post_id)).toBe(false);
  });

  it("posts without paper_case are unaffected by the ?case= filter (case row not placed on other boards)", async () => {
    const env = makeEnv();
    const res = await postJson(env, "/api/v1/plaza/posts", post({ channel: "c-bbs02b", board_kind: "complaint" }));
    expect(res.status).toBe(201);
    const postId = ((await res.json()) as { post_id: string }).post_id;
    const view = (await (await app.request(`/api/v1/plaza/posts/${postId}`, { headers: AUTH_HEADERS }, env)).json()) as { post: Record<string, unknown> };
    expect(view.post.tags).toBeUndefined();
    const filtered = (await (await app.request("/api/v1/plaza/channels/c-bbs02b/threads?case=observation", { headers: AUTH_HEADERS }, env)).json()) as {
      threads: unknown[];
    };
    expect(filtered.threads).toEqual([]);
  });
});

describe("V3-BBS-25 unified node view", () => {
  it("GET /plaza/node/:post_id returns node_type derived from paper_case tag", async () => {
    const env = makeEnv();
    const created = (await (await postJson(env, "/api/v1/plaza/posts", post({ channel: "c-bbs25", paper_case: "hypothesis" }))).json()) as {
      post_id: string;
    };
    const res = await app.request(`/api/v1/plaza/node/${created.post_id}`, { headers: AUTH_HEADERS }, env);
    expect(res.status).toBe(200);
    const view = (await res.json()) as { node_type: string; post_id: string };
    expect(view.node_type).toBe("paper:hypothesis");
    expect(view.post_id).toBe(created.post_id);
  });

  it("falls back to board_kind when no paper_case tag is present", async () => {
    const env = makeEnv();
    const created = (await (await postJson(env, "/api/v1/plaza/posts", post({ channel: "c-bbs25c", board_kind: "improvement" }))).json()) as {
      post_id: string;
    };
    const view = (await (await app.request(`/api/v1/plaza/node/${created.post_id}`, { headers: AUTH_HEADERS }, env)).json()) as { node_type: string };
    expect(view.node_type).toBe("improvement");
  });

  it("404 for unknown post_id", async () => {
    const env = makeEnv();
    const res = await app.request("/api/v1/plaza/node/nope", { headers: AUTH_HEADERS }, env);
    expect(res.status).toBe(404);
  });

  it("collects backlinks from posts citing this node via cite_refs", async () => {
    const env = makeEnv();
    const target = (await (await postJson(env, "/api/v1/plaza/posts", post({ channel: "c-bbs25b", topic: "target" }))).json()) as { post_id: string };
    const citing = (await (await postJson(env, "/api/v1/plaza/posts", post({
      channel: "c-bbs25b", topic: "citing", cite_refs: [{ type: "post", id: target.post_id }],
    }))).json()) as { post_id: string };
    const view = (await (await app.request(`/api/v1/plaza/node/${target.post_id}`, { headers: AUTH_HEADERS }, env)).json()) as { backlinks: string[] };
    expect(view.backlinks).toContain(citing.post_id);
  });
});

describe("V3-BBS-25(2026-08-01追記) — GET /plaza/node/:id は dispatchNode 経由で content/ppr-cycle-node も解決する", () => {
  it("resolves a content node (not just plaza-post) via the shared dispatcher", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const store = new TruthStore(bucket);
    await store.putEventAt(
      "truth/ihl.research.content.v1/content-1.json",
      makeEnvelope({ type: "ihl.research.content.v1", data: { content_id: "content-1", title: "論文X" } }),
    );
    const res = await app.request("/api/v1/plaza/node/content-1", { headers: AUTH_HEADERS }, env);
    expect(res.status).toBe(200);
    const view = (await res.json()) as { node_type: string; post_id: string; channel: string; thread_id: string; post: Record<string, unknown> };
    expect(view.node_type).toBe("content");
    expect(view.post_id).toBe("content-1");
    expect(view.channel).toBe(""); // plaza概念を持たないため空文字(捏造しない)
    expect(view.thread_id).toBe("");
    expect(view.post).toMatchObject({ content_id: "content-1", title: "論文X" });
  });

  it("resolves a ppr-cycle-node via the shared dispatcher", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const store = new TruthStore(bucket);
    await store.putEventAt(
      "truth/ihl.ppr.cycle_node.v1/cycle-1.json",
      makeEnvelope({ type: "ihl.ppr.cycle_node.v1", data: { node_id: "cycle-1", node_type: "hypothesis" } }),
    );
    const res = await app.request("/api/v1/plaza/node/cycle-1", { headers: AUTH_HEADERS }, env);
    expect(res.status).toBe(200);
    const view = (await res.json()) as { node_type: string };
    expect(view.node_type).toBe("ppr-cycle-node");
  });

  it("still resolves plaza-post as before (backward compatible)", async () => {
    const env = makeEnv();
    const created = (await (await postJson(env, "/api/v1/plaza/posts", post({ channel: "c-bbs25d", board_kind: "guide" }))).json()) as { post_id: string };
    const res = await app.request(`/api/v1/plaza/node/${created.post_id}`, { headers: AUTH_HEADERS }, env);
    const view = (await res.json()) as { node_type: string };
    expect(view.node_type).toBe("guide");
  });
});

describe("V3-PPR-08(2026-08-01追記) — 板側の citation-link 統合(bridgeplan J1-3)", () => {
  it("posting with cite_refs type=paper auto-appends a citation-link event (content_id/target_ref=thread)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const created = (await (await postJson(env, "/api/v1/plaza/posts", post({
      channel: "c-ppr08", topic: "cites-a-paper", cite_refs: [{ type: "paper", id: "paper-xyz" }],
    }))).json()) as { post_id: string; thread_id: string };

    const store = new TruthStore(bucket);
    const links = (await store.listEvents("truth/ihl.citation.link.v1/paper-xyz/")).map((e) => (e as { data: Record<string, unknown> }).data);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ content_id: "paper-xyz", target_ref: { type: "thread", id: created.thread_id }, link_kind: "discussed_in" });
  });

  it("GET .../paper-citations unions cite_refs(type=paper) with citation-link rows (via_citation_link)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const created = (await (await postJson(env, "/api/v1/plaza/posts", post({
      channel: "c-ppr08b", topic: "t", cite_refs: [{ type: "paper", id: "paper-abc" }],
    }))).json()) as { post_id: string; thread_id: string };

    const res = await app.request(`/api/v1/plaza/threads/${created.thread_id}/paper-citations`, { headers: AUTH_HEADERS }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { paper_ids: string[]; via_citation_link: string[] };
    expect(body.paper_ids).toContain("paper-abc");
    expect(body.via_citation_link).toContain("paper-abc"); // 自動appendされたcitation-link経由でも見える
  });

  it("appendCitationLink is a pure append (INSERT ONLY) helper usable outside the POST route", async () => {
    const bucket = new FakeR2Bucket();
    const store = new TruthStore(bucket);
    const r1 = await appendCitationLink(store, "paper-1", "actor-1", { type: "thread", id: "thread-1" }, "cites");
    expect(r1).not.toBeNull();
    const rows = await store.listEvents("truth/ihl.citation.link.v1/paper-1/");
    expect(rows).toHaveLength(1);
  });
});

describe("V3-BBS-11 create-check search-first gate", () => {
  it("suggests creation when there is no strong existing match", async () => {
    const env = makeEnv();
    const res = await app.request("/api/v1/plaza/create-check?q=" + encodeURIComponent("誰も書いていない話題X9Z"), { headers: AUTH_HEADERS }, env);
    const body = (await res.json()) as { suggest_create: boolean };
    expect(body.suggest_create).toBe(true);
  });

  it("discourages creation (suggest_create=false) when a strong (substring) match exists", async () => {
    const env = makeEnv();
    await postJson(env, "/api/v1/plaza/posts", post({ channel: "c-bbs11", topic: "コバエ対策まとめ" }));
    const res = await app.request("/api/v1/plaza/create-check?q=" + encodeURIComponent("コバエ対策"), { headers: AUTH_HEADERS }, env);
    const body = (await res.json()) as { suggest_create: boolean; candidates: unknown[] };
    expect(body.suggest_create).toBe(false);
    expect(body.candidates.length).toBeGreaterThan(0);
  });

  it("empty q suggests create with no candidates (no-op, not an error)", async () => {
    const env = makeEnv();
    const res = await app.request("/api/v1/plaza/create-check?q=", { headers: AUTH_HEADERS }, env);
    expect(res.status).toBe(200);
    expect((await res.json()) as { candidates: unknown[] }).toMatchObject({ suggest_create: true, candidates: [] });
  });
});

// w3-plaza(第3波持ち越し): BBS-11 要件文「掲示板検索は自然言語/タグ/RAGの3方式を提供する」。
// nl(既定)は既存 rankThreadSearch のまま。ここでは残り2方式(tag/rag)を検証する。
describe("V3-BBS-11 search modes(自然言語/タグ/RAG の3方式)", () => {
  it("mode=tag はタグ完全一致で検索する(トピック文言に一致語が無くても見つかる)", async () => {
    const env = makeEnv();
    const created = (await (await postJson(env, "/api/v1/plaza/posts", post({
      channel: "c-bbs11-tag", topic: "無関係なタイトル", tags: ["breeding-tips"],
    }))).json()) as { post_id: string };
    const res = await app.request("/api/v1/plaza/search?mode=tag&q=breeding-tips&channel=c-bbs11-tag", { headers: AUTH_HEADERS }, env);
    const body = (await res.json()) as { mode: string; matches: { thread_id: string }[] };
    expect(body.mode).toBe("tag");
    expect(body.matches.map((m) => m.thread_id)).toEqual([created.post_id]);
  });

  it("mode=tag は部分文字列では一致しない(自然言語方式との違い)", async () => {
    const env = makeEnv();
    await postJson(env, "/api/v1/plaza/posts", post({ channel: "c-bbs11-tag2", tags: ["breeding-tips"] }));
    const res = await app.request("/api/v1/plaza/search?mode=tag&q=breeding&channel=c-bbs11-tag2", { headers: AUTH_HEADERS }, env);
    const body = (await res.json()) as { matches: unknown[] };
    expect(body.matches).toEqual([]);
  });

  it("mode=rag は rag_fallback:true を明示しつつ決定論結果を返す(embedding未配線を偽らない)", async () => {
    const env = makeEnv();
    await postJson(env, "/api/v1/plaza/posts", post({ channel: "c-bbs11-rag", topic: "コバエ対策まとめ" }));
    const res = await app.request("/api/v1/plaza/search?mode=rag&q=" + encodeURIComponent("コバエ対策") + "&channel=c-bbs11-rag", { headers: AUTH_HEADERS }, env);
    const body = (await res.json()) as { mode: string; rag_fallback: boolean; matches: unknown[] };
    expect(body.mode).toBe("rag");
    expect(body.rag_fallback).toBe(true);
    expect(body.matches.length).toBeGreaterThan(0);
  });
});

describe("V3-BBS-12 AI-assisted board creation draft (deterministic fallback)", () => {
  it("draftBoardFromText splits first sentence as title and rest as description", () => {
    const draft = draftBoardFromText("コバエ対策の情報交換をしたい。餌の管理や温度湿度の話も歓迎です。");
    expect(draft.title).toContain("コバエ対策");
    expect(draft.description.length).toBeGreaterThan(0);
    expect(Array.isArray(draft.tags)).toBe(true);
  });

  it("POST /plaza/board-draft requires free_text", async () => {
    const env = makeEnv();
    const res = await postJson(env, "/api/v1/plaza/board-draft", {});
    expect(res.status).toBe(400);
  });

  it("POST /plaza/board-draft returns a draft for valid free_text", async () => {
    const env = makeEnv();
    const res = await postJson(env, "/api/v1/plaza/board-draft", { free_text: "産地の異なる血統を比較したい。" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string };
    expect(body.title.length).toBeGreaterThan(0);
  });
});
