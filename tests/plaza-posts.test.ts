// 知の広場 投稿 TC(design-c5.md §K6 §4 / V3-BBS-01/03/05/20/36-topic)。topic 必須(欠落 400)・
// projectThread の ULID 昇順 materialized view・correction_of は原投稿を上書きせず追記共存・
// permalink 不変・欠落 cite target に tombstone・reply_to/mentions/tags/cite_refs のチャネル分離・
// 同 post_id 二重 409・未認証 401。actor_id はセッション principal 強制刻印(V3-AUT-17)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { deriveActorId, ulid } from "@ihl/truth";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

const DEV_ACTOR = await deriveActorId("dev@ihl.local");
const CHANNEL = "knowledge-board";

function post(env: ReturnType<typeof makeEnv>, body: unknown) {
  return app.request(
    "/api/v1/plaza/posts",
    { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(body) },
    env,
  );
}
function root(overrides: Record<string, unknown> = {}) {
  return { channel: CHANNEL, topic: "beetle care", board_kind: "guide", body: "root body", ...overrides };
}

describe("POST /api/v1/plaza/posts", () => {
  it("rejects a post missing the required topic with 400", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const res = await post(env, { channel: CHANNEL, board_kind: "guide", body: "no topic" });
    expect(res.status).toBe(400);
  });

  it("forces actor_id to the session principal ignoring a spoofed body actor_id", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const created = await post(env, root({ actor_id: "attacker" }));
    expect(created.status).toBe(201);
    const { post_id } = (await created.json()) as { post_id: string };
    const detail = await app.request(`/api/v1/plaza/posts/${post_id}`, { headers: AUTH_HEADERS }, env);
    const { post: p } = (await detail.json()) as { post: Record<string, unknown> };
    expect(p.actor_id).toBe(DEV_ACTOR);
  });

  it("returns thread posts in ULID ascending order regardless of insertion order", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const rootId = ulid(1000);
    const p2 = ulid(3000);
    const p3 = ulid(2000);
    await post(env, root({ post_id: rootId, thread_id: rootId }));
    // insert the higher ULID first to prove the projection sorts, not insertion order.
    await post(env, root({ post_id: p2, thread_id: rootId, body: "third" }));
    await post(env, root({ post_id: p3, thread_id: rootId, body: "second" }));

    const res = await app.request(`/api/v1/plaza/threads/${rootId}`, { headers: AUTH_HEADERS }, env);
    expect(res.status).toBe(200);
    const view = (await res.json()) as { posts: { post_id: string }[] };
    expect(view.posts.map((p) => p.post_id)).toEqual([rootId, p3, p2]);
  });

  it("keeps both the original and its correction (no overwrite) and leaves the permalink stable", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const rootId = ulid(1000);
    await post(env, root({ post_id: rootId, thread_id: rootId, body: "original text" }));
    const corrId = ulid(2000);
    await post(env, root({ post_id: corrId, thread_id: rootId, correction_of: rootId, body: "corrected text" }));

    const view = (await (await app.request(`/api/v1/plaza/threads/${rootId}`, { headers: AUTH_HEADERS }, env)).json()) as {
      posts: { post_id: string; corrections?: string[] }[];
    };
    // both posts coexist
    expect(view.posts.map((p) => p.post_id).sort()).toEqual([rootId, corrId].sort());
    // original carries the correction as an appended section, not an overwrite
    const orig = view.posts.find((p) => p.post_id === rootId)!;
    expect(orig.corrections).toContain(corrId);

    // permalink stable: fetching the original still returns the unmodified body
    const detail = (await (await app.request(`/api/v1/plaza/posts/${rootId}`, { headers: AUTH_HEADERS }, env)).json()) as {
      post: { body: string };
    };
    expect(detail.post.body).toBe("original text");
  });

  it("records a tombstone for a missing cite target without deleting the cite_ref", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const rootId = ulid(1000);
    await post(env, root({ post_id: rootId, thread_id: rootId, cite_refs: [{ type: "post", id: "MISSING-POST" }] }));
    const view = (await (await app.request(`/api/v1/plaza/threads/${rootId}`, { headers: AUTH_HEADERS }, env)).json()) as {
      posts: { cite_refs?: { id: string }[] }[];
      tombstones: { ref: { id: string }; reason: string }[];
    };
    expect(view.tombstones.some((t) => t.ref.id === "MISSING-POST")).toBe(true);
    // cite_ref itself is preserved on the post (not removed)
    expect(view.posts[0].cite_refs?.[0].id).toBe("MISSING-POST");
  });

  it("stores reply_to / mentions / tags / cite_refs on separate channels", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const rootId = ulid(1000);
    await post(env, root({ post_id: rootId, thread_id: rootId }));
    const replyId = ulid(2000);
    await post(
      env,
      root({
        post_id: replyId,
        thread_id: rootId,
        reply_to: rootId,
        mentions: [DEV_ACTOR],
        tags: ["care", "diet"],
        cite_refs: [{ type: "paper", id: "PAP-1" }],
      }),
    );
    const detail = (await (await app.request(`/api/v1/plaza/posts/${replyId}`, { headers: AUTH_HEADERS }, env)).json()) as {
      post: Record<string, unknown>;
    };
    expect(detail.post.reply_to).toBe(rootId);
    expect(detail.post.mentions).toEqual([DEV_ACTOR]);
    expect(detail.post.tags).toEqual(["care", "diet"]);
    expect(detail.post.cite_refs).toEqual([{ type: "paper", id: "PAP-1" }]);
  });

  it("stores an optional context_individual_id reference and round-trips it on GET", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const rootId = ulid(1000);
    await post(env, root({ post_id: rootId, thread_id: rootId, context_individual_id: "IND-1" }));
    const detail = (await (await app.request(`/api/v1/plaza/posts/${rootId}`, { headers: AUTH_HEADERS }, env)).json()) as {
      post: Record<string, unknown>;
    };
    expect(detail.post.context_individual_id).toBe("IND-1");
  });

  it("succeeds without context_individual_id (optional field, no regression)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const created = await post(env, root());
    expect(created.status).toBe(201);
    const { post_id } = (await created.json()) as { post_id: string };
    const detail = (await (await app.request(`/api/v1/plaza/posts/${post_id}`, { headers: AUTH_HEADERS }, env)).json()) as {
      post: Record<string, unknown>;
    };
    expect(detail.post.context_individual_id).toBeUndefined();
  });

  it("rejects a duplicate post_id with 409 (append-only put-if-absent)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const id = ulid();
    const first = await post(env, root({ post_id: id, thread_id: id }));
    expect(first.status).toBe(201);
    const dup = await post(env, root({ post_id: id, thread_id: id, body: "overwrite attempt" }));
    expect(dup.status).toBe(409);
  });

  it("stores an optional species_id reference and round-trips it on GET (SW-1)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const rootId = ulid(1000);
    await post(env, root({ post_id: rootId, thread_id: rootId, species_id: "Dynastes hercules" }));
    const detail = (await (await app.request(`/api/v1/plaza/posts/${rootId}`, { headers: AUTH_HEADERS }, env)).json()) as {
      post: Record<string, unknown>;
    };
    expect(detail.post.species_id).toBe("Dynastes hercules");
  });
});

// HDR-1(c9-structure-canon.md §1c・A1#4): スレの species_id はルート投稿
// (thread_id===post_id)の値を代表値とみなし、GET /plaza/channels/:channel/threads・
// GET /plaza/search の ?species= 絞り込みに使う(SW-1)。
describe("HDR-1: species_id narrowing(A1#4)", () => {
  it("GET /plaza/channels/:channel/threads の ?species= はルート投稿の species_id を代表値に完全一致(大小無視)で絞る", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const hercThread = ulid(1000);
    await post(env, root({ post_id: hercThread, thread_id: hercThread, topic: "hercules care", species_id: "Dynastes hercules" }));
    const otherThread = ulid(2000);
    await post(env, root({ post_id: otherThread, thread_id: otherThread, topic: "no species tag" }));

    const scoped = (await (await app.request(
      `/api/v1/plaza/channels/${CHANNEL}/threads?species=dynastes%20hercules`,
      { headers: AUTH_HEADERS },
      env,
    )).json()) as { threads: { thread_id: string }[] };
    expect(scoped.threads.map((t) => t.thread_id)).toEqual([hercThread]);

    const all = (await (await app.request(`/api/v1/plaza/channels/${CHANNEL}/threads`, { headers: AUTH_HEADERS }, env)).json()) as {
      threads: unknown[];
    };
    expect(all.threads).toHaveLength(2);
  });

  it("GET /plaza/search の ?species= はルート投稿の species_id を代表値に絞る", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const hercThread = ulid(1000);
    await post(env, root({ post_id: hercThread, thread_id: hercThread, topic: "コバエがわいた", species_id: "Dynastes hercules" }));
    const otherThread = ulid(2000);
    await post(env, root({ post_id: otherThread, thread_id: otherThread, topic: "コバエ大量発生" }));

    const scoped = (await (await app.request(
      "/api/v1/plaza/search?q=コバエ&species=dynastes%20hercules",
      { headers: AUTH_HEADERS },
      env,
    )).json()) as { matches: { thread_id: string }[] };
    expect(scoped.matches.map((m) => m.thread_id)).toEqual([hercThread]);

    const unscoped = (await (await app.request("/api/v1/plaza/search?q=コバエ", { headers: AUTH_HEADERS }, env)).json()) as {
      matches: { thread_id: string }[];
    };
    expect(unscoped.matches.map((m) => m.thread_id).sort()).toEqual([hercThread, otherThread].sort());
  });
});

describe("plaza post routes are protected", () => {
  it("returns 401 for unauthenticated write and read", async () => {
    const env = makeEnv();
    const reqs = [
      app.request("/api/v1/plaza/posts", { method: "POST", body: "{}" }, env),
      app.request("/api/v1/plaza/threads/x", {}, env),
      app.request("/api/v1/plaza/posts/x", {}, env),
    ];
    for (const r of reqs) expect((await r).status).toBe(401);
  });
});
