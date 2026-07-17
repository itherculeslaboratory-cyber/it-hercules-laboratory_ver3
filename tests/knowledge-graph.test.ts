// V3-WIK-20 — 設計書・コード・掲示板・論文・フォーク系統を「同一の細胞構造」で相互参照
// できるようにする(文明の図書館)。RAGの1クエリで意図・系譜・被引用を返す。専用の
// 常駐グラフDB/インデックスは作らず、既存の cite_refs/cited_paper_ids/citations/
// forked_from を束ねる決定論投影(buildReferenceIndex/projectKnowledgeCell)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, ulid } from "@ihl/truth";
import { projectKnowledgeCell } from "../apps/api/src/knowledge-graph";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

function post(env: ReturnType<typeof makeEnv>, path: string, body: unknown) {
  return app.request(`/api/v1${path}`, { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(body) }, env);
}

describe("projectKnowledgeCell", () => {
  it("returns null for an unknown id", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    expect(await projectKnowledgeCell(s, "NOPE")).toBeNull();
  });

  it("resolves intent from a plaza post, lineage from fork forked_from chain, and referenced_by from cite_refs", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const s = new TruthStore(bucket);

    // fork_id is stamped as the envelope id (plaza-fork route regulation) -> must be a valid ULID.
    const grandparent = ulid(1000);
    const parent = ulid(2000);
    const leaf = ulid(3000);
    const child = ulid(4000);
    const rootId = ulid(5000);

    // A plaza post cites the leaf fork by id -> a reverse "referenced_by" edge for that fork.
    await post(env, "/plaza/posts", {
      channel: "ch", topic: "beetle husbandry", board_kind: "guide",
      post_id: rootId, thread_id: rootId, body: `see [ihl:cite type=fork id=${leaf}]`,
    });

    // fork lineage: "origin-component" (not itself a fork node) -> grandparent -> parent -> leaf.
    // every fork requires forked_from+visibility (plaza-fork.schema.json).
    const fork = (forkId: string, title: string, forkedFrom: string) =>
      post(env, "/plaza/forks", { fork_id: forkId, target_type: "component", visibility: "public", title, forked_from: forkedFrom });
    await fork(grandparent, "root theme", "origin-component");
    await fork(parent, "mid fork", grandparent);
    await fork(leaf, "leaf fork", parent);
    // a child fork of leaf -> descendant
    await fork(child, "child fork", leaf);

    const postCell = await projectKnowledgeCell(s, rootId);
    expect(postCell).toMatchObject({ kind: "post", intent: "beetle husbandry" });

    const forkCell = await projectKnowledgeCell(s, leaf);
    expect(forkCell?.kind).toBe("fork");
    expect(forkCell?.intent).toBe("leaf fork");
    // ancestors walk forked_from up to (and including) the terminal non-node ref.
    expect(forkCell?.lineage.ancestors).toEqual([parent, grandparent, "origin-component"]);
    expect(forkCell?.lineage.descendants).toEqual([child]);
    // referenced_by includes both the plaza-post citation AND the child fork's forked_from
    // edge (forked_from is itself modeled as a reference edge -> lineage children also "cite" their parent).
    expect(forkCell?.referenced_by.sort()).toEqual([child, rootId].sort());
  });

  it("resolves intent+citations from a research paper (content_id) via cited_paper_ids", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const s = new TruthStore(bucket);
    await post(env, "/research/content", {
      content_id: "PAPER-A", content_type: "paper", title: "Paper A",
      sections: { purpose: { filled: true, text: "x" }, hypothesis: { filled: false, text: "" }, conditions: { filled: false, text: "" }, verification: { filled: false, text: "" }, phase: { filled: false, text: "" }, gap: { filled: false, text: "" } },
      completeness_pct: 17,
    });
    await post(env, "/research/content", {
      content_id: "PAPER-B", content_type: "paper", title: "Paper B (cites A)", cited_paper_ids: ["PAPER-A"],
      sections: { purpose: { filled: true, text: "y" }, hypothesis: { filled: false, text: "" }, conditions: { filled: false, text: "" }, verification: { filled: false, text: "" }, phase: { filled: false, text: "" }, gap: { filled: false, text: "" } },
      completeness_pct: 17,
    });

    const cellA = await projectKnowledgeCell(s, "PAPER-A");
    expect(cellA?.kind).toBe("content");
    expect(cellA?.intent).toBe("Paper A");
    expect(cellA?.referenced_by).toEqual(["PAPER-B"]);
  });
});

describe("GET /api/v1/knowledge/cell/{id}", () => {
  it("returns 200 with the knowledge cell for a known fork", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const forkId = ulid();
    await post(env, "/plaza/forks", { fork_id: forkId, target_type: "component", visibility: "public", title: "known", forked_from: "origin" });
    const res = await app.request(`/api/v1/knowledge/cell/${forkId}`, { headers: AUTH_HEADERS }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { intent: string };
    expect(body.intent).toBe("known");
  });

  it("404s for an unknown id", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const res = await app.request("/api/v1/knowledge/cell/NOPE", { headers: AUTH_HEADERS }, env);
    expect(res.status).toBe(404);
  });

  it("requires auth (401)", async () => {
    const res = await app.request("/api/v1/knowledge/cell/x", {}, makeEnv());
    expect(res.status).toBe(401);
  });
});
