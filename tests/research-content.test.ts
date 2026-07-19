// WIK-16/13/14/17 共通 CMS routes（design-k5 §4）。content は INSERT ONLY（同一 content_id
// 再 put=409）・content_type enum。投稿直後に 4 本柱（fulltext/tag/user/node）prefix scan 投影で
// 即ヒット（維持型二次インデックス不使用）。ai_tags は user_tags を上書きしない・RAG_PRIORITY 順・
// ai_tags≤10・suggest 非永続で確認 POST のみ append。share→chat_log→chat-index 投影反映。
import { describe, expect, it } from "vitest";
import { TruthStore, ulid } from "@ihl/truth";
import app from "../apps/api/src/index";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv, makeEnvelope } from "./helpers";

const RESEARCH_TAG_TYPE = "ihl.research.tag_event.v1";

function post(bucket: FakeR2Bucket, path: string, body: unknown): Promise<Response> {
  return app.request(
    path,
    { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(body) },
    makeEnv(bucket),
  );
}
function get(bucket: FakeR2Bucket, path: string): Promise<Response> {
  return app.request(path, { method: "GET", headers: AUTH_HEADERS }, makeEnv(bucket));
}
async function createContent(bucket: FakeR2Bucket, body: Record<string, unknown>): Promise<Response> {
  return post(bucket, "/api/v1/research/content", body);
}
// system 層タグは人手 route では発行できない（V3-WIK-14 自動編集不可）。agent/batch 経路を
// 模して frozen tag-event を直接 seed する（aggregateContentTags が prefix scan で拾う）。
async function seedSystemTag(bucket: FakeR2Bucket, contentId: string, tag: string): Promise<void> {
  const env = makeEnvelope({
    type: RESEARCH_TAG_TYPE,
    dataschema: "schemas/frozen/tag-event.schema.json",
    data: {
      tag_event_id: ulid(),
      target_type: "cross",
      target_id: contentId,
      tag,
      tag_type: "system",
      action: "add",
      source_type: "ai",
      created_at: new Date().toISOString(),
      schema_version: 1,
    },
  });
  const res = await new TruthStore(bucket).putEventAt(`truth/${RESEARCH_TAG_TYPE}/cross-${contentId}-${ulid()}.json`, env);
  expect(res.status).toBe("inserted");
}

describe("WIK-16 content INSERT ONLY + content_type enum", () => {
  it("same content_id re-put returns 409 (append-only, storage put-if-absent)", async () => {
    const bucket = new FakeR2Bucket();
    const a = await createContent(bucket, { content_id: "C-1", content_type: "article", title: "A" });
    expect(a.status).toBe(201);
    const b = await createContent(bucket, { content_id: "C-1", content_type: "article", title: "A again" });
    expect(b.status).toBe(409);
  });

  it("unknown content_type is rejected 400 by schema enum", async () => {
    const bucket = new FakeR2Bucket();
    const res = await createContent(bucket, { content_id: "C-2", content_type: "bogus", title: "A" });
    expect(res.status).toBe(400);
  });

  it("stored actor_id is force-stamped to the session principal (V3-AUT-17)", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, { content_id: "C-3", content_type: "article", title: "A", actor_id: "attacker" });
    const detail = (await (await get(bucket, "/api/v1/research/content/C-3")).json()) as { actor_id: string };
    expect(detail.actor_id).not.toBe("attacker");
    expect(detail.actor_id.length).toBeGreaterThan(0);
  });
});

describe("WIK-13 four search pillars hit immediately after append (prefix scan projection)", () => {
  it("fulltext(title/body) · tag · user · node all return the just-posted content", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, {
      content_id: "S-1", content_type: "article", title: "Alpha report", body_markdown: "beta gamma body",
    });
    // author actor_id (session principal) を投影から取得（DEV_TOKEN 由来）。
    const detail = (await (await get(bucket, "/api/v1/research/content/S-1")).json()) as { actor_id: string };
    // tag pillar: user 層タグを確認 POST で永続化。
    await post(bucket, "/api/v1/research/content/S-1/tags", { tag: "delta", tag_type: "user" });

    const ids = async (q: Record<string, unknown>) =>
      ((await (await post(bucket, "/api/v1/research/search", q)).json()) as { results: Array<{ content_id: string }> })
        .results.map((r) => r.content_id);

    expect(await ids({ text: "Alpha" })).toContain("S-1"); // fulltext title(summary)
    expect(await ids({ text: "gamma" })).toContain("S-1"); // fulltext body(payload)
    expect(await ids({ tags: ["delta"] })).toContain("S-1"); // tag pillar
    expect(await ids({ user: detail.actor_id })).toContain("S-1"); // user(author) pillar
    expect(await ids({ node: "S-1" })).toContain("S-1"); // node(content_id) pillar
  });

  it("embedding pillar: query_vector + content_vectors above threshold hits; below threshold or unmatched vectors miss", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, { content_id: "V-near", content_type: "article", title: "no keyword overlap" });
    await createContent(bucket, { content_id: "V-far", content_type: "article", title: "no keyword overlap either" });

    const res = await post(bucket, "/api/v1/research/search", {
      query_vector: [1, 0, 0],
      content_vectors: { "V-near": [0.99, 0.01, 0], "V-far": [0, 1, 0] }, // near: cos~1 (>=0.7) / far: cos=0
    });
    const results = ((await res.json()) as { results: Array<{ content_id: string; matched: string[] }> }).results;
    const near = results.find((r) => r.content_id === "V-near");
    expect(near?.matched).toContain("embedding");
    expect(results.find((r) => r.content_id === "V-far")).toBeUndefined(); // below EMBEDDING_SIMILARITY_MIN, no other pillar hit
  });

  it("embedding pillar is a no-op when query_vector is absent (embedding stays OFF by default)", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, { content_id: "V-noquery", content_type: "article", title: "irrelevant" });
    const res = await post(bucket, "/api/v1/research/search", { content_vectors: { "V-noquery": [1, 0, 0] } });
    const results = ((await res.json()) as { results: Array<{ content_id: string }> }).results;
    expect(results.find((r) => r.content_id === "V-noquery")).toBeUndefined();
  });
});

// HDR-1(c9-structure-canon.md §1c・A1#4): ヘッダー観測対象の species_id パススルー(SW-1
// 同型)+ GET /research/content・POST /research/search の絞り込み(individual-routes.ts
// listIndividualsFor と同じ完全一致・大小無視)。
describe("HDR-1: species_id narrowing(A1#4)", () => {
  it("species_id はパススルーされ round-trip する(任意フィールド)", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, { content_id: "SP-1", content_type: "article", title: "A", species_id: "Dynastes hercules" });
    const detail = (await (await get(bucket, "/api/v1/research/content/SP-1")).json()) as { species_id?: string };
    expect(detail.species_id).toBe("Dynastes hercules");
  });

  it("GET /research/content の ?species= は完全一致(大小無視)で絞る・省略時は全件", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, { content_id: "SP-2", content_type: "article", title: "H", species_id: "Dynastes hercules" });
    await createContent(bucket, { content_id: "SP-3", content_type: "article", title: "C", species_id: "Chalcosoma caucasus" });
    await createContent(bucket, { content_id: "SP-4", content_type: "article", title: "無タグ" });

    const scoped = (await (await get(bucket, "/api/v1/research/content?species=dynastes%20hercules")).json()) as {
      items: { content_id: string }[];
    };
    expect(scoped.items.map((i) => i.content_id)).toEqual(["SP-2"]);

    const all = (await (await get(bucket, "/api/v1/research/content")).json()) as { items: unknown[] };
    expect(all.items).toHaveLength(3);
  });

  it("POST /research/search の URL ?species= は content.species_id で絞る", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, {
      content_id: "SP-5", content_type: "article", title: "beetle notes", species_id: "Dynastes hercules",
    });
    await createContent(bucket, { content_id: "SP-6", content_type: "article", title: "beetle notes" });

    const scoped = (await (await post(bucket, "/api/v1/research/search?species=dynastes%20hercules", { text: "beetle" })).json()) as {
      results: { content_id: string }[];
    };
    expect(scoped.results.map((r) => r.content_id)).toEqual(["SP-5"]);

    const all = (await (await post(bucket, "/api/v1/research/search", { text: "beetle" })).json()) as {
      results: { content_id: string }[];
    };
    expect(all.results.map((r) => r.content_id).sort()).toEqual(["SP-5", "SP-6"].sort());
  });
});

describe("WIK-14 three-layer tags + suggest + RAG_PRIORITY", () => {
  it("ai tag does not overwrite a user tag (separate layers survive)", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, { content_id: "T-1", content_type: "article", title: "x" });
    await post(bucket, "/api/v1/research/content/T-1/tags", { tag: "keep", tag_type: "user" });
    await post(bucket, "/api/v1/research/content/T-1/tags", { tag: "auto", tag_type: "ai" });
    const detail = (await (await get(bucket, "/api/v1/research/content/T-1")).json()) as {
      tags: { user_tags: string[]; ai_tags: string[] };
    };
    expect(detail.tags.user_tags).toContain("keep"); // user layer untouched by ai append
    expect(detail.tags.ai_tags).toContain("auto");
  });

  it("suggest is non-persistent — no tag_event appended, returns persisted:false, ai_tags<=10", async () => {
    const bucket = new FakeR2Bucket();
    // 11 distinct 3+ char tokens → suggest must cap at 10.
    const body = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda";
    await createContent(bucket, { content_id: "T-2", content_type: "article", title: "words", body_markdown: body });
    const tagKeysBefore = [...bucket.objects.keys()].filter((k) => k.includes("tag_event")).length;
    const res = (await (await post(bucket, "/api/v1/research/content/T-2/tags/suggest", {})).json()) as {
      ai_tags: string[]; persisted: boolean;
    };
    expect(res.persisted).toBe(false);
    expect(res.ai_tags.length).toBeLessThanOrEqual(10);
    expect(res.ai_tags.length).toBe(10); // 11 tokens capped to AI_TAGS_MAX
    const tagKeysAfter = [...bucket.objects.keys()].filter((k) => k.includes("tag_event")).length;
    expect(tagKeysAfter).toBe(tagKeysBefore); // nothing persisted
  });

  it("human tags route rejects tag_type=system with 400 and persists nothing (WIK-14 system layer is agent-only)", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, { content_id: "SY-1", content_type: "article", title: "x" });
    const before = [...bucket.objects.keys()].filter((k) => k.includes("tag_event")).length;
    const res = await post(bucket, "/api/v1/research/content/SY-1/tags", { tag: "boost", tag_type: "system" });
    expect(res.status).toBe(400);
    const after = [...bucket.objects.keys()].filter((k) => k.includes("tag_event")).length;
    expect(after).toBe(before); // 検索順位操作用の system タグは 1 件も append されない
  });

  it("search results order by RAG_PRIORITY: system tag > ai tag > user tag", async () => {
    const bucket = new FakeR2Bucket();
    // content_id order deliberately reversed vs desired rank order to prove RAG
    // priority (not content_id) is the primary sort key.
    await createContent(bucket, { content_id: "R-user", content_type: "article", title: "u" });
    await createContent(bucket, { content_id: "R-ai", content_type: "article", title: "a" });
    await createContent(bucket, { content_id: "R-system", content_type: "article", title: "s" });
    await post(bucket, "/api/v1/research/content/R-user/tags", { tag: "hot", tag_type: "user" });
    await post(bucket, "/api/v1/research/content/R-ai/tags", { tag: "hot", tag_type: "ai" });
    await seedSystemTag(bucket, "R-system", "hot"); // system 層は agent 経路のみ（人手 route は 400）
    const results = ((await (await post(bucket, "/api/v1/research/search", { tags: ["hot"] })).json()) as {
      results: Array<{ content_id: string; rank_source: string }>;
    }).results;
    expect(results.map((r) => r.rank_source)).toEqual(["system", "ai", "user"]);
    expect(results.map((r) => r.content_id)).toEqual(["R-system", "R-ai", "R-user"]);
  });
});

describe("WIK-17 share -> chat_log -> chat-index projection", () => {
  it("POST /research/shared appends content_type=chat_log and chat-index reflects it", async () => {
    const bucket = new FakeR2Bucket();
    const res = await post(bucket, "/api/v1/research/shared", { title: "shared note", text: "hello world" });
    expect(res.status).toBe(201);
    const { content_id } = (await res.json()) as { content_id: string };

    // listContent type filter proves it was stored as chat_log.
    const list = (await (await get(bucket, "/api/v1/research/content?type=chat_log")).json()) as {
      items: Array<{ content_id: string; content_type: string }>;
    };
    expect(list.items.map((i) => i.content_id)).toContain(content_id);
    expect(list.items.every((i) => i.content_type === "chat_log")).toBe(true);

    const idx = (await (await get(bucket, "/api/v1/research/chat-index")).json()) as {
      items: Array<{ content_id: string; title: string }>;
    };
    expect(idx.items.map((i) => i.content_id)).toContain(content_id);
  });

  it("shared body strips LaTeX-forbidden chars so the chat_log content validates", async () => {
    const bucket = new FakeR2Bucket();
    const res = await post(bucket, "/api/v1/research/shared", { title: "t", text: "cost $5 and c:\\path" });
    expect(res.status).toBe(201); // sanitized body_markdown passes content.schema pattern
  });
});
