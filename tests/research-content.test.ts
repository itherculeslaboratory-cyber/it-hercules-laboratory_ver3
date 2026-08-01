// WIK-16/13/14/17 共通 CMS routes（design-k5 §4）。content は INSERT ONLY（同一 content_id
// 再 put=409）・content_type enum。投稿直後に 4 本柱（fulltext/tag/user/node）prefix scan 投影で
// 即ヒット（維持型二次インデックス不使用）。ai_tags は user_tags を上書きしない・RAG_PRIORITY 順・
// ai_tags≤10・suggest 非永続で確認 POST のみ append。share→chat_log→chat-index 投影反映。
import { describe, expect, it } from "vitest";
import { TruthStore, ulid, deriveActorId } from "@ihl/truth";
import app from "../apps/api/src/index";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv, makeEnvelope } from "./helpers";

const RESEARCH_TAG_TYPE = "ihl.research.tag_event.v1";
const RESEARCH_CONTENT_TYPE = "ihl.research.content.v1";
const RESEARCH_CONTENT_SCHEMA = "schemas/events/content.schema.json";

// T1(g68-refs3・裁定R0801-9398e1 R-5)適用後は POST /research/content が常に lineage_meta(gen0)
// を刻むため、HTTP 経由では「lineage_meta を持たない旧レコード(仮想root)」を新規に作れなくなる
// (発注書 T1-5 の想定どおり)。仮想rootの分岐(R-1/R-6)は消えていないので、生イベントを直接
// truth/ に置いて legacy 形を再現する(seedSystemTag と同型・route を経由しない best-effort seed)。
async function seedLegacyContent(bucket: FakeR2Bucket, body: Record<string, unknown>): Promise<void> {
  const data: Record<string, unknown> = {
    actor_id: "legacy-seed",
    created_at: "2026-01-01T00:00:00.000Z",
    schema_version: "1",
    ...body,
  };
  const env = makeEnvelope({
    type: RESEARCH_CONTENT_TYPE,
    dataschema: RESEARCH_CONTENT_SCHEMA,
    provenance: { generator_kind: "human", actor_id: "legacy-seed" },
    data,
  });
  const res = await new TruthStore(bucket).putEventAt(`truth/${RESEARCH_CONTENT_TYPE}/${data.content_id}.json`, env);
  expect(res.status).toBe("inserted");
}

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

describe("V3-PPR-11 GET /research/dataset (公開データセット・匿名化・画像バイナリ非含有)", () => {
  async function seedObs(bucket: FakeR2Bucket, type: string, key: string, data: Record<string, unknown>): Promise<void> {
    const env = makeEnvelope({
      type,
      dataschema: `schemas/events/${type.replace("ihl.", "").replace(/\./g, "-").replace("-v1", "")}.schema.json`,
      data,
    });
    const res = await new TruthStore(bucket).putEventAt(key, env);
    expect(res.status).toBe("inserted");
  }

  it("engine_version でフィルタし、画像バイナリを含めず public_user_id=actor_id で匿名化する", async () => {
    const bucket = new FakeR2Bucket();
    await seedObs(bucket, "ihl.obs.capture.v1", "truth/ihl.obs.capture.v1/cap-1.json", {
      capture_id: "cap-1", actor_id: "actor-x", domain: "biology", subject_ref: "individual/ind-1",
    });
    await seedObs(bucket, "ihl.obs.photo.v1", "truth/ihl.obs.photo.v1/cap-1-p1.json", {
      photo_id: "p1", capture_id: "cap-1", actor_id: "actor-x",
      media_key: "media/photo/p1", content_type: "image/jpeg", size_bytes: 100, sha256: "a".repeat(64),
    });
    await seedObs(bucket, "ihl.obs.analysis.v1", "truth/ihl.obs.analysis.v1/cap-1-a1.json", {
      analysis_id: "run-1", capture_id: "cap-1", correction_semver: "1.2.0", is_manual_edit: false, actor_id: "actor-x",
      results: { deltaE: 1.5, D2: 0.02 },
    });
    await seedObs(bucket, "ihl.obs.analysis.v1", "truth/ihl.obs.analysis.v1/cap-1-a2.json", {
      analysis_id: "run-2", capture_id: "cap-1", correction_semver: "0.9.0", is_manual_edit: false, actor_id: "actor-x",
      results: { deltaE: 9.9 },
    });

    const all = (await (await get(bucket, "/api/v1/research/dataset")).json()) as {
      count: number; items: Array<{ individual_uuid: string | null; public_user_id: string; engine_version: string | null; image_sha256: string | null; metrics: Record<string, unknown> }>;
    };
    expect(all.count).toBe(2);

    const filtered = (await (await get(bucket, "/api/v1/research/dataset?engine_version=1.2.0")).json()) as { count: number; items: unknown[] };
    expect(filtered.count).toBe(1);
    const row = filtered.items[0] as { individual_uuid: string | null; public_user_id: string; engine_version: string | null; image_sha256: string | null; metrics: Record<string, unknown> };
    expect(row.individual_uuid).toBe("ind-1");
    expect(row.public_user_id).toBe("actor-x"); // 匿名化=既存actor_id(生メール等は含まれない)
    expect(row.engine_version).toBe("1.2.0");
    expect(row.image_sha256).toBe("a".repeat(64));
    expect(row.metrics).toEqual({ deltaE: 1.5, D2: 0.02 });
    // R2 画像バイナリ本体(media_key等)は含めない(事実キーのみ・PPR-11)。
    expect(JSON.stringify(row)).not.toContain("media/photo");
  });

  it("データが無ければ count=0 の空データセットを返す(誇張ゼロ)", async () => {
    const bucket = new FakeR2Bucket();
    const res = await get(bucket, "/api/v1/research/dataset");
    expect(res.status).toBe(200);
    expect((await res.json()) as { count: number; items: unknown[] }).toEqual({ engine_version: null, license: "CC0", count: 0, items: [] });
  });
});

describe("V3-PPR-08 GET /research/content/:id/cited-by-posts (論文側の逆引き投影・O(n)全件走査)", () => {
  it("集める: cite_refs(type=paper,id=論文)を持つ投稿だけを横断して返す(索引は無い=全 plaza post を走査)", async () => {
    const bucket = new FakeR2Bucket();
    const paper = await createContent(bucket, {
      content_id: "PAP-CITED-1", content_type: "paper", title: "Cited paper",
      sections: {
        purpose: { filled: false, text: "" }, hypothesis: { filled: false, text: "" },
        conditions: { filled: false, text: "" }, verification: { filled: false, text: "" },
        phase: { filled: false, text: "" }, gap: { filled: false, text: "" },
      },
      completeness_pct: 0,
    });
    expect(paper.status).toBe(201);
    const citing = await post(bucket, "/api/v1/plaza/posts", {
      channel: "c-ppr08rev", board_kind: "guide", topic: "citing thread", body: "見て", cite_refs: [{ type: "paper", id: "PAP-CITED-1" }],
    });
    expect(citing.status).toBe(201);
    const { post_id: citingPostId, thread_id: citingThreadId } = (await citing.json()) as { post_id: string; thread_id: string };
    // a post citing a DIFFERENT paper must not show up.
    await post(bucket, "/api/v1/plaza/posts", {
      channel: "c-ppr08rev", board_kind: "guide", topic: "unrelated", body: "別件", cite_refs: [{ type: "paper", id: "PAP-OTHER" }],
    });

    const res = await get(bucket, "/api/v1/research/content/PAP-CITED-1/cited-by-posts");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { content_id: string; citing_posts: { post_id: string; thread_id: string; channel: string }[] };
    expect(body.content_id).toBe("PAP-CITED-1");
    expect(body.citing_posts).toEqual([{ post_id: citingPostId, thread_id: citingThreadId, channel: "c-ppr08rev" }]);
  });

  it("404s for an unknown content_id", async () => {
    const bucket = new FakeR2Bucket();
    const res = await get(bucket, "/api/v1/research/content/nope/cited-by-posts");
    expect(res.status).toBe(404);
  });

  it("no citing posts -> empty array (not an error)", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, {
      content_id: "PAP-LONELY", content_type: "paper", title: "Uncited",
      sections: {
        purpose: { filled: false, text: "" }, hypothesis: { filled: false, text: "" },
        conditions: { filled: false, text: "" }, verification: { filled: false, text: "" },
        phase: { filled: false, text: "" }, gap: { filled: false, text: "" },
      },
      completeness_pct: 0,
    });
    const res = await get(bucket, "/api/v1/research/content/PAP-LONELY/cited-by-posts");
    const body = (await res.json()) as { citing_posts: unknown[] };
    expect(body.citing_posts).toEqual([]);
  });
});

describe("V3-AIP-45 GET /research/content/:id/reference-count (既存 projectReferenceCounter を呼ぶだけ・呼び出し経路が無かった状態を解消)", () => {
  it("0件のとき0を返す", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, { content_id: "REF-1", content_type: "article", title: "x" });
    const res = await get(bucket, "/api/v1/research/content/REF-1/reference-count");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ content_id: "REF-1", reference_count: 0 });
  });

  it("N件のときNを返す(provenance.input_event_ids で lineage 引用する2件をseed)", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, { content_id: "REF-2", content_type: "article", title: "x" });
    const stored = (await new TruthStore(bucket).readEvent("truth/ihl.research.content.v1/REF-2.json")) as { id: string };
    for (let i = 0; i < 2; i++) {
      await new TruthStore(bucket).putEvent(makeEnvelope({
        id: ulid(),
        provenance: { generator_kind: "agent", agent_name: "claude-code", input_event_ids: [stored.id] },
      }));
    }
    // 別 target を引用する1件は数えない(誤カウント防止の確認)。
    await new TruthStore(bucket).putEvent(makeEnvelope({
      id: ulid(),
      provenance: { generator_kind: "agent", agent_name: "claude-code", input_event_ids: [ulid()] },
    }));
    const res = await get(bucket, "/api/v1/research/content/REF-2/reference-count");
    expect(await res.json()).toEqual({ content_id: "REF-2", reference_count: 2 });
  });

  it("存在しない content_id は404", async () => {
    const bucket = new FakeR2Bucket();
    const res = await get(bucket, "/api/v1/research/content/nope/reference-count");
    expect(res.status).toBe(404);
  });

  it("未認証だと401(protected route のまま・PUBLIC_READ_ROUTES に足していない)", async () => {
    const res = await app.request(
      "/api/v1/research/content/REF-1/reference-count",
      { method: "GET" },
      makeEnv(new FakeR2Bucket()),
    );
    expect(res.status).toBe(401);
  });

  // g67-refs1(設計R0801-436936 §2案1-A・§7 S1完了条件①②): 書き込み経路を実際に足したので、
  // 経路を経由すると reference-count が実測で1以上になることを確認する(配線ではなく数字が
  // 動くことの証明・§7「本番で有効」の定義)。
  it("引用付き content を POST → reference-count が1以上になる(citations[].type=paper 経路)", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, { content_id: "REFW-SRC-1", content_type: "article", title: "source" });
    const res = await createContent(bucket, {
      content_id: "REFW-DST-1", content_type: "article", title: "citer",
      citations: [{ type: "paper", id: "REFW-SRC-1", label: "src" }],
    });
    expect(res.status).toBe(201);
    const count = await get(bucket, "/api/v1/research/content/REFW-SRC-1/reference-count");
    expect(await count.json()).toEqual({ content_id: "REFW-SRC-1", reference_count: 1 });
  });

  it("cited_paper_ids 経路でも reference-count が1以上になる(citations と重複排除される)", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, { content_id: "REFW-SRC-2", content_type: "article", title: "source" });
    const res = await createContent(bucket, {
      content_id: "REFW-DST-2", content_type: "article", title: "citer",
      cited_paper_ids: ["REFW-SRC-2"],
      citations: [{ type: "paper", id: "REFW-SRC-2", label: "same target(dedup 確認)" }],
    });
    expect(res.status).toBe(201);
    const count = await get(bucket, "/api/v1/research/content/REFW-SRC-2/reference-count");
    // citations と cited_paper_ids が同一 target を指しても2重計上しない(集合で重複排除・設計§9-5)。
    expect(await count.json()).toEqual({ content_id: "REFW-SRC-2", reference_count: 1 });
  });

  it("存在しない引用先は best-effort で無視され、書き込み自体は失敗しない", async () => {
    const bucket = new FakeR2Bucket();
    const res = await createContent(bucket, {
      content_id: "REFW-DST-3", content_type: "article", title: "citer",
      citations: [{ type: "paper", id: "REFW-NOPE", label: "not found" }],
    });
    expect(res.status).toBe(201); // 解決できない引用先があっても本体の書き込みは道連れにしない
  });

  it("fork-template 後、元 paper の reference-count が+1になる(paper-match-routes.ts経路)", async () => {
    const bucket = new FakeR2Bucket();
    const paperBody = {
      content_id: "REFW-TMPL-1", content_type: "paper", title: "Template",
      sections: {
        purpose: { filled: false, text: "" }, hypothesis: { filled: false, text: "" },
        conditions: { filled: false, text: "" }, verification: { filled: false, text: "" },
        phase: { filled: false, text: "" }, gap: { filled: false, text: "" },
      },
      completeness_pct: 0,
    };
    await createContent(bucket, paperBody);
    const before = await (await get(bucket, "/api/v1/research/content/REFW-TMPL-1/reference-count")).json();
    expect(before).toEqual({ content_id: "REFW-TMPL-1", reference_count: 0 });

    const forkRes = await post(bucket, "/api/v1/research/content/REFW-TMPL-1/fork-template", {});
    expect(forkRes.status).toBe(201);

    const after = await (await get(bucket, "/api/v1/research/content/REFW-TMPL-1/reference-count")).json();
    expect(after).toEqual({ content_id: "REFW-TMPL-1", reference_count: 1 });
  });
});

describe("V3-PPR-08 GET /research/content/:id/citation-count (被引用リンク件数の集計・一覧しか無かった状態を解消)", () => {
  const paperBody = (contentId: string) => ({
    content_id: contentId, content_type: "paper", title: "Cited paper",
    sections: {
      purpose: { filled: false, text: "" }, hypothesis: { filled: false, text: "" },
      conditions: { filled: false, text: "" }, verification: { filled: false, text: "" },
      phase: { filled: false, text: "" }, gap: { filled: false, text: "" },
    },
    completeness_pct: 0,
  });

  it("0件のとき0を返す", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, paperBody("CIT-1"));
    const res = await get(bucket, "/api/v1/research/content/CIT-1/citation-count");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ content_id: "CIT-1", citation_count: 0 });
  });

  it("N件のときNを返す(2スレから引用されたcitation-linkをprefix scanで数える)", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, paperBody("CIT-2"));
    await post(bucket, "/api/v1/plaza/posts", {
      channel: "c-cit", board_kind: "guide", topic: "t1", body: "見て", cite_refs: [{ type: "paper", id: "CIT-2" }],
    });
    await post(bucket, "/api/v1/plaza/posts", {
      channel: "c-cit", board_kind: "guide", topic: "t2", body: "見て2", cite_refs: [{ type: "paper", id: "CIT-2" }],
    });
    const res = await get(bucket, "/api/v1/research/content/CIT-2/citation-count");
    expect(await res.json()).toEqual({ content_id: "CIT-2", citation_count: 2 });
  });

  it("存在しない content_id は404", async () => {
    const bucket = new FakeR2Bucket();
    const res = await get(bucket, "/api/v1/research/content/nope/citation-count");
    expect(res.status).toBe(404);
  });

  it("未認証だと401(protected route のまま・PUBLIC_READ_ROUTES に足していない)", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, paperBody("CIT-3"));
    const res = await app.request(
      "/api/v1/research/content/CIT-3/citation-count",
      { method: "GET" },
      makeEnv(new FakeR2Bucket()),
    );
    expect(res.status).toBe(401);
  });
});

describe("V3-AIP-108/109 POST /research/content/:id/next-generation (世代機構・設計R0801-436936 §3案2-A・§7 S2)", () => {
  const paperBody = (contentId: string, title = "Gen paper") => ({
    content_id: contentId, content_type: "paper", title,
    sections: {
      purpose: { filled: false, text: "" }, hypothesis: { filled: false, text: "" },
      conditions: { filled: false, text: "" }, verification: { filled: false, text: "" },
      phase: { filled: false, text: "" }, gap: { filled: false, text: "" },
    },
    completeness_pct: 0,
  });

  it("2回叩くと generation が 0→1→2 になる(既存レコードの世代は省略=0扱いの起点)", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, paperBody("GEN-1"));
    const gen1 = await post(bucket, "/api/v1/research/content/GEN-1/next-generation", { title: "Gen paper v1" });
    expect(gen1.status).toBe(201);
    const gen1Body = (await gen1.json()) as { content_id: string; generation: number; parent_content_id: string };
    expect(gen1Body.generation).toBe(1);
    expect(gen1Body.parent_content_id).toBe("GEN-1");

    const gen2 = await post(bucket, `/api/v1/research/content/${gen1Body.content_id}/next-generation`, { title: "Gen paper v2" });
    expect(gen2.status).toBe(201);
    const gen2Body = (await gen2.json()) as { content_id: string; generation: number; parent_content_id: string };
    expect(gen2Body.generation).toBe(2);
    expect(gen2Body.parent_content_id).toBe(gen1Body.content_id);
  });

  it("gen1 の citation-count は gen0 と独立(gen0への引用はgen1に数えない)", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, paperBody("GEN-CIT-0"));
    const gen1Res = await post(bucket, "/api/v1/research/content/GEN-CIT-0/next-generation", {});
    const { content_id: gen1Id } = (await gen1Res.json()) as { content_id: string };

    // gen0 を引用する投稿を1件作る(citation-link は gen0 の content_id 宛)。
    await post(bucket, "/api/v1/plaza/posts", {
      channel: "c-gencit", board_kind: "guide", topic: "citing gen0", body: "見て",
      cite_refs: [{ type: "paper", id: "GEN-CIT-0" }],
    });

    const gen0Count = await (await get(bucket, "/api/v1/research/content/GEN-CIT-0/citation-count")).json();
    const gen1Count = await (await get(bucket, `/api/v1/research/content/${gen1Id}/citation-count`)).json();
    // gen0: 板からの引用1件のみ(citation-linkは content_id 単位のキー空間なので gen1 作成時に
    // gen1 の名前空間へ積まれる derived_from リンクは gen0 側には現れない=独立の証明)。
    expect(gen0Count).toEqual({ content_id: "GEN-CIT-0", citation_count: 1 });
    // gen1: 生まれたてで人からの引用はゼロ(derived_from=系譜の辺は被引用に数えない・
    // 裁定R0801-9398e1 §4是正。T4適用前は自分の derived_from を自分で数えて1を返していた)。
    expect(gen1Count).toEqual({ content_id: gen1Id, citation_count: 0 });
  });

  it("gen0 の reference-count は gen1 作成で +1 される(input_event_ids刻印の帰結・消失や二重計上が無いことの確認)", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, paperBody("GEN-REF-0"));
    const before = await (await get(bucket, "/api/v1/research/content/GEN-REF-0/reference-count")).json();
    expect(before).toEqual({ content_id: "GEN-REF-0", reference_count: 0 });

    await post(bucket, "/api/v1/research/content/GEN-REF-0/next-generation", {});

    const after = await (await get(bucket, "/api/v1/research/content/GEN-REF-0/reference-count")).json();
    // next-generation は provenance.input_event_ids で gen0 の envelope.id を引用するので
    // gen0 の reference-count 自体は+1になる(fork-templateと同じ帰結)が、これは gen0 が
    // 消えず・世代交代で数字が壊れないことの確認(gen1作成"前後"での不変性=作成後にさらに
    // 変化しないこと)であり二重計上や消失が起きていないことを検証する。
    expect(after).toEqual({ content_id: "GEN-REF-0", reference_count: 1 });
  });

  it("content_type=paper 以外は400(設計§9-3・fork-templateと同じ限定)", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, { content_id: "GEN-ART-1", content_type: "article", title: "not a paper" });
    const res = await post(bucket, "/api/v1/research/content/GEN-ART-1/next-generation", {});
    expect(res.status).toBe(400);
  });

  it("存在しない content_id は404", async () => {
    const bucket = new FakeR2Bucket();
    const res = await post(bucket, "/api/v1/research/content/nope/next-generation", {});
    expect(res.status).toBe(404);
  });

  it("未認証だと401(protected route のまま・新routeはPUBLIC_ROUTESに載せない)", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, paperBody("GEN-AUTH-1"));
    const res = await app.request(
      "/api/v1/research/content/GEN-AUTH-1/next-generation",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) },
      makeEnv(bucket),
    );
    expect(res.status).toBe(401);
  });

  it("仮想root(lineage_metaを持たない旧レコード)に next-generation すると gen1 は generation=1 だが parent_uuid/ancestor_chain を持たない(裁定R0801-9398e1 R-1)", async () => {
    const bucket = new FakeR2Bucket();
    // T1適用後は POST /research/content が常に lineage_meta(gen0)を刻むため、HTTP経由では
    // lineage_meta を持たない旧レコードを新規に作れない(発注書T1-5)。生イベント直接書き込みで
    // 「世代機構より前に作られた既存レコード」を再現する(仮想root分岐=R-6は消えていない)。
    // actor_id はセッション本人(dev@ihl.local)に合わせる — このテストの検証対象は世代機構
    // (仮想root)であり所有者チェック(g74-restown)ではないため、legacy-seed既定のままだと
    // 無関係な403で落ちる(既存挙動の意図は変えず、新チェックの前提を満たすだけの修正)。
    await seedLegacyContent(bucket, { ...paperBody("GEN-VROOT-1"), actor_id: await deriveActorId("dev@ihl.local") });
    const gen1Res = await post(bucket, "/api/v1/research/content/GEN-VROOT-1/next-generation", { title: "Gen v1" });
    expect(gen1Res.status).toBe(201);
    const gen1Body = (await gen1Res.json()) as { content_id: string; generation: number };
    expect(gen1Body.generation).toBe(1);

    const detail = await (await get(bucket, `/api/v1/research/content/${gen1Body.content_id}`)).json();
    expect((detail as { lineage_meta?: Record<string, unknown> }).lineage_meta).toBeDefined();
    expect((detail as { lineage_meta: Record<string, unknown> }).lineage_meta.parent_uuid).toBeUndefined();
    expect((detail as { lineage_meta: Record<string, unknown> }).lineage_meta.ancestor_chain).toBeUndefined();
  });

  it("他人のcontentへのnext-generationは403(所有者チェック・裁定R0801-ac8938 RESTOWN-1=A案)", async () => {
    const bucket = new FakeR2Bucket();
    await seedLegacyContent(bucket, { ...paperBody("GEN-OWNER-1"), actor_id: "other-owner" });
    const res = await post(bucket, "/api/v1/research/content/GEN-OWNER-1/next-generation", { title: "should be blocked" });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("NOT_OWNER");
  });
});

describe("V3-AIP-108/109 GET /research/content/:id/generations (世代横断ビュー・設計R0801-436936 §3案2-A c・裁定R0801-9398e1 T2)", () => {
  const paperBody = (contentId: string, title = "Gen view paper") => ({
    content_id: contentId, content_type: "paper", title,
    sections: {
      purpose: { filled: false, text: "" }, hypothesis: { filled: false, text: "" },
      conditions: { filled: false, text: "" }, verification: { filled: false, text: "" },
      phase: { filled: false, text: "" }, gap: { filled: false, text: "" },
    },
    completeness_pct: 0,
  });

  it("3世代を作ると、どの世代のidから叩いても1回のレスポンスで全世代のカウントが取れる", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, paperBody("GV-0"));
    const gen1Res = await post(bucket, "/api/v1/research/content/GV-0/next-generation", { title: "v1" });
    const { content_id: gen1Id } = (await gen1Res.json()) as { content_id: string };
    const gen2Res = await post(bucket, `/api/v1/research/content/${gen1Id}/next-generation`, { title: "v2" });
    const { content_id: gen2Id } = (await gen2Res.json()) as { content_id: string };

    type GenItem = { generation: number; content_id: string; reference_count: number; citation_count: number; lineage_recorded: boolean };
    for (const queryId of ["GV-0", gen1Id, gen2Id]) {
      const res = await get(bucket, `/api/v1/research/content/${queryId}/generations`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { content_id: string; generations: GenItem[] };
      expect(body.generations.map((g) => g.generation)).toEqual([0, 1, 2]);
      expect(body.generations.map((g) => g.content_id)).toEqual(["GV-0", gen1Id, gen2Id]);
      expect(body.generations.map((g) => g.lineage_recorded)).toEqual([true, true, true]);
      // T4是正(裁定R0801-9398e1 §4)後は derived_from(系譜の辺)を被引用に数えないため、
      // 板からの引用が一切無いこのテストでは全世代の citation_count が0(V3-AIP-109の
      // 「新世代で0から再カウント」の逐語どおり・誰も引用していないなら0が正直な数字)。
      expect(body.generations.map((g) => g.citation_count)).toEqual([0, 0, 0]);
    }
  });

  it("fork-template で作った子は generations に現れない(derived_from を fork と世代で混同しない)", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, paperBody("GV-FORK-0"));
    const forkRes = await post(bucket, "/api/v1/research/content/GV-FORK-0/fork-template", {});
    expect(forkRes.status).toBe(201);
    const { content_id: forkChildId } = (await forkRes.json()) as { content_id: string };

    const res = await get(bucket, "/api/v1/research/content/GV-FORK-0/generations");
    const body = (await res.json()) as { generations: { content_id: string }[] };
    expect(body.generations.map((g) => g.content_id)).toEqual(["GV-FORK-0"]);
    expect(body.generations.map((g) => g.content_id)).not.toContain(forkChildId);
  });

  it("未認証だと401(protected route のまま・新routeはPUBLIC_ROUTESに載せない)", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, paperBody("GV-AUTH-1"));
    const res = await app.request(
      "/api/v1/research/content/GV-AUTH-1/generations",
      { method: "GET" },
      makeEnv(bucket),
    );
    expect(res.status).toBe(401);
  });

  it("存在しない content_id は404", async () => {
    const bucket = new FakeR2Bucket();
    const res = await get(bucket, "/api/v1/research/content/nope/generations");
    expect(res.status).toBe(404);
  });
});

describe("V3-AIP-108/109 S4 復元(POST .../restore・GET .../current・設計R0801-436936 §4案4-A・REF-1裁定=○)", () => {
  const paperBody = (contentId: string, title = "Restore paper") => ({
    content_id: contentId, content_type: "paper", title,
    sections: {
      purpose: { filled: false, text: "" }, hypothesis: { filled: false, text: "" },
      conditions: { filled: false, text: "" }, verification: { filled: false, text: "" },
      phase: { filled: false, text: "" }, gap: { filled: false, text: "" },
    },
    completeness_pct: 0,
  });

  it("戻した後 GET .../current が旧世代を返す(pointer_id昇順の最後・resolved_by=pointer)", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, paperBody("RST-0"));
    const gen1Res = await post(bucket, "/api/v1/research/content/RST-0/next-generation", { title: "v1" });
    const { content_id: gen1Id } = (await gen1Res.json()) as { content_id: string };
    await post(bucket, `/api/v1/research/content/${gen1Id}/next-generation`, { title: "v2" });

    // gen2 が今の現行(next-generationのみ・まだ一度も戻していない)。ここで gen0(RST-0)へ戻す。
    const restoreRes = await post(bucket, "/api/v1/research/content/RST-0/restore", {});
    expect(restoreRes.status).toBe(201);

    const currentRes = await get(bucket, "/api/v1/research/content/RST-0/current");
    expect(currentRes.status).toBe(200);
    const currentBody = (await currentRes.json()) as { current_content_id: string; resolved_by: string };
    expect(currentBody.current_content_id).toBe("RST-0");
    expect(currentBody.resolved_by).toBe("pointer");

    // 系譜内のどの世代のidから current を叩いても同じ lineage_root を経由して同じ結果になる。
    const currentFromGen1 = await get(bucket, `/api/v1/research/content/${gen1Id}/current`);
    expect(((await currentFromGen1.json()) as { current_content_id: string }).current_content_id).toBe("RST-0");
  });

  it("戻しても generation は増えない(復元前後でlineage最大generationが不変・既存イベントは書き換えない)", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, paperBody("RST-GEN-0"));
    const gen1Res = await post(bucket, "/api/v1/research/content/RST-GEN-0/next-generation", { title: "v1" });
    const { content_id: gen1Id } = (await gen1Res.json()) as { content_id: string };

    const before = await (await get(bucket, "/api/v1/research/content/RST-GEN-0/generations")).json();
    type GenItem = { generation: number; content_id: string };
    const maxBefore = Math.max(...(before as { generations: GenItem[] }).generations.map((g) => g.generation));
    expect(maxBefore).toBe(1); // gen0/gen1のみ

    const restoreRes = await post(bucket, "/api/v1/research/content/RST-GEN-0/restore", {});
    expect(restoreRes.status).toBe(201);

    const after = await (await get(bucket, "/api/v1/research/content/RST-GEN-0/generations")).json();
    const genList = (after as { generations: GenItem[] }).generations;
    const maxAfter = Math.max(...genList.map((g) => g.generation));
    expect(maxAfter).toBe(1); // 戻しても世代は増えていない(=更新回数は水増しされない)
    expect(genList.map((g) => g.content_id).sort()).toEqual(["RST-GEN-0", gen1Id].sort());

    // current は gen0 を指すが、gen1 自体は消えていない(append-only・「戻す」は新イベントを
    // 1件足しただけで既存イベントを書き換えていない)。
    const current = (await (await get(bucket, "/api/v1/research/content/RST-GEN-0/current")).json()) as {
      current_content_id: string;
    };
    expect(current.current_content_id).toBe("RST-GEN-0");
    const gen1Detail = await get(bucket, `/api/v1/research/content/${gen1Id}`);
    expect(gen1Detail.status).toBe(200); // gen1 は依然として readable(削除・書き換えされていない)
  });

  it("ポインタが1件も無い系譜は generation最大へフォールバックする(resolved_by=generation_max_fallback)", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, paperBody("RST-FB-0"));
    const gen1Res = await post(bucket, "/api/v1/research/content/RST-FB-0/next-generation", { title: "v1" });
    const { content_id: gen1Id } = (await gen1Res.json()) as { content_id: string };

    const res = await get(bucket, "/api/v1/research/content/RST-FB-0/current");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { current_content_id: string; resolved_by: string };
    expect(body.current_content_id).toBe(gen1Id); // gen1(generation最大)が現行
    expect(body.resolved_by).toBe("generation_max_fallback");
  });

  it("存在しない content_id は404(restore/currentとも)", async () => {
    const bucket = new FakeR2Bucket();
    const restoreRes = await post(bucket, "/api/v1/research/content/nope/restore", {});
    expect(restoreRes.status).toBe(404);
    const currentRes = await get(bucket, "/api/v1/research/content/nope/current");
    expect(currentRes.status).toBe(404);
  });

  it("未認証だと401(protected route のまま・新routeはPUBLIC_ROUTESに載せない)", async () => {
    const bucket = new FakeR2Bucket();
    await createContent(bucket, paperBody("RST-AUTH-1"));
    const restoreRes = await app.request(
      "/api/v1/research/content/RST-AUTH-1/restore",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) },
      makeEnv(bucket),
    );
    expect(restoreRes.status).toBe(401);
    const currentRes = await app.request(
      "/api/v1/research/content/RST-AUTH-1/current",
      { method: "GET" },
      makeEnv(bucket),
    );
    expect(currentRes.status).toBe(401);
  });

  it("他人のcontentへのrestoreは403(所有者チェック・裁定R0801-ac8938 RESTOWN-1=A案)", async () => {
    const bucket = new FakeR2Bucket();
    await seedLegacyContent(bucket, { ...paperBody("RST-OWNER-1"), actor_id: "other-owner" });
    const res = await post(bucket, "/api/v1/research/content/RST-OWNER-1/restore", {});
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("NOT_OWNER");
  });

  it("EVENT_NAMES発火の実測: 壊れた content-current data(pointer_id欠落)は putEventAt が invalid で弾く", async () => {
    const bucket = new FakeR2Bucket();
    const store = new TruthStore(bucket);
    const badData = {
      // pointer_id を欠落させる(required違反)。EVENT_NAMES に "content-current" が
      // 登録されていなければ eventSchemaFor() が null を返し、この検証自体がスキップされて
      // invalid ではなく inserted になってしまう(設計R0801-436936 §1-7の罠)。
      lineage_root: "root-x",
      current_content_id: "cur-x",
      actor_id: "tester",
      created_at: "2026-08-01T00:00:00.000Z",
      schema_version: "1",
    };
    const env = makeEnvelope({
      type: "ihl.research.content_current.v1",
      dataschema: "schemas/events/content-current.schema.json",
      data: badData,
    });
    const res = await store.putEventAt("truth/ihl.research.content_current.v1/root-x/bad-1.json", env);
    expect(res.status).toBe("invalid");
  });
});

describe("V3-PPR-03 POST /research/content: filled:true な section の text 空は400で拒否", () => {
  it("filled:true かつ text が空文字だと INVALID_SECTION_FILLED_WITHOUT_TEXT で400", async () => {
    const bucket = new FakeR2Bucket();
    const res = await createContent(bucket, {
      content_id: "PAP-PPR03-1", content_type: "paper", title: "Bad section",
      sections: { purpose: { filled: true, text: "" } },
      completeness_pct: 0,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details: string[] };
    expect(body.error).toBe("INVALID_SECTION_FILLED_WITHOUT_TEXT");
    expect(body.details[0]).toContain("purpose");
  });

  it("filled:true かつ text が空白のみでも同様に400で拒否", async () => {
    const bucket = new FakeR2Bucket();
    const res = await createContent(bucket, {
      content_id: "PAP-PPR03-2", content_type: "paper", title: "Whitespace section",
      sections: { gap: { filled: true, text: "   " } },
      completeness_pct: 0,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("INVALID_SECTION_FILLED_WITHOUT_TEXT");
  });

  it("filled:true かつ text ありなら201で通る(既存の正常系が壊れていないことの確認)", async () => {
    const bucket = new FakeR2Bucket();
    const res = await createContent(bucket, {
      content_id: "PAP-PPR03-3", content_type: "paper", title: "Good section",
      sections: {
        purpose: { filled: true, text: "目的が書いてある" },
        hypothesis: { filled: false, text: "" }, conditions: { filled: false, text: "" },
        verification: { filled: false, text: "" }, phase: { filled: false, text: "" }, gap: { filled: false, text: "" },
      },
      completeness_pct: 17,
    });
    expect(res.status).toBe(201);
  });
});
