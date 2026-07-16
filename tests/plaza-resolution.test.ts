// round-16 裁定(OQ-PLZ-01/02/03) 知の広場スレの解決マーク・昇格ステータス・重み付き票
// (design-c5.md §K6 / docs/planning/c7/wireframes-core5.md §F1-F3 / plaza-constants.ts)。
// 解決マーク=スレ主のみ(append-only・取消は新イベント追記)。昇格ステータス=cite/追試/
// stance母数の純算術判定(仮値4/2/5/12)。重み付き票=projectConsensus の actorWeights 引数。
import { describe, expect, it } from "vitest";
import { TruthStore, ulid, deriveActorId } from "@ihl/truth";
import app from "../apps/api/src/index";
import { projectConsensus, projectPromotionStatus } from "../apps/api/src/plaza-routes";
import {
  PLZ_VERIFIED_CITE_MIN,
  PLZ_VERIFIED_RETRY_MIN,
  PLZ_REFUTED_RETRY_MIN,
  PLZ_UNRESOLVED_STANCE_MIN,
  PLZ_VOTE_WEIGHT_CERTIFIED_BREEDER,
} from "../apps/api/src/plaza-constants";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

const POST_TYPE = "ihl.plaza.post.v1";
const POST_SCHEMA = "schemas/events/plaza-post.schema.json";
const SIGNAL_TYPE = "ihl.plaza.signal.v1";
const SIGNAL_SCHEMA = "schemas/events/plaza-signal.schema.json";
const STANCE_TYPE = "ihl.plaza.stance.v1";
const STANCE_SCHEMA = "schemas/events/plaza-stance.schema.json";

function post(bucket: FakeR2Bucket, path: string, body: unknown, headers = AUTH_HEADERS): Promise<Response> {
  return app.request(path, { method: "POST", headers, body: JSON.stringify(body) }, makeEnv(bucket));
}
function get(bucket: FakeR2Bucket, path: string): Promise<Response> {
  return app.request(path, { headers: AUTH_HEADERS }, makeEnv(bucket));
}

// route の書込 actor は DEV_TOKEN 固定(dev@ihl.local)なので非オーナーは TruthStore 直挿し
// で別 actor_id の post/signal/stance を用意する(plaza-consensus.test.ts の seedStance と同型)。
async function seedPost(bucket: FakeR2Bucket, opts: {
  postId: string; threadId: string; actorId: string; channel?: string;
  citeRefs?: Array<{ type: string; id: string }>;
}) {
  const iso = new Date().toISOString();
  const channel = opts.channel ?? "c";
  const data: Record<string, unknown> = {
    post_id: opts.postId, actor_id: opts.actorId, channel, topic: "t", board_kind: "guide",
    thread_id: opts.threadId, body: "b", created_at: iso, schema_version: "1",
  };
  if (opts.citeRefs) data.cite_refs = opts.citeRefs;
  // envelope.id は ULID 26 桁パターン必須(schemas/events/envelope.schema.json)。data.post_id は
  // minLength:1 のみなので "KT-VERIFIED" 等の可読 ID を使えるが envelope.id は必ず ulid() で発行する。
  const res = await new TruthStore(bucket).putEventAt(`truth/${POST_TYPE}/${channel}/${opts.threadId}/${opts.postId}.json`, {
    specversion: "1.0", id: ulid(), source: "test", type: POST_TYPE, time: iso,
    dataschema: POST_SCHEMA, provenance: { generator_kind: "human", actor_id: opts.actorId }, data,
  });
  if (res.status !== "inserted") throw new Error(`seedPost failed: ${JSON.stringify(res)}`);
}
async function seedRetrySignal(bucket: FakeR2Bucket, threadId: string, outcome: "retry_reproduced" | "retry_not_reproduced", actorId = "someone") {
  const iso = new Date().toISOString();
  const signalId = ulid();
  const data = {
    signal_id: signalId, actor_id: actorId, target_type: "plaza_thread", target_id: threadId,
    signal: outcome, created_at: iso, schema_version: "1",
  };
  await new TruthStore(bucket).putEventAt(`truth/${SIGNAL_TYPE}/plaza_thread/${threadId}/${signalId}.json`, {
    specversion: "1.0", id: signalId, source: "test", type: SIGNAL_TYPE, time: iso,
    dataschema: SIGNAL_SCHEMA, provenance: { generator_kind: "human", actor_id: actorId }, data,
  });
}
async function seedStance(bucket: FakeR2Bucket, statementId: string, actorId: string, value: string) {
  const iso = new Date().toISOString();
  const stanceId = ulid();
  await new TruthStore(bucket).putEventAt(`truth/${STANCE_TYPE}/${statementId}/${stanceId}.json`, {
    specversion: "1.0", id: stanceId, source: "test", type: STANCE_TYPE, time: iso,
    dataschema: STANCE_SCHEMA, provenance: { generator_kind: "human", actor_id: actorId },
    data: { stance_id: stanceId, actor_id: actorId, statement_id: statementId, value, created_at: iso, schema_version: "1" },
  });
}

describe("OQ-PLZ-03 resolution mark (thread owner only, append-only)", () => {
  it("thread owner can resolve; GET thread reflects resolved:true", async () => {
    const bucket = new FakeR2Bucket();
    const rootId = ulid(1000);
    const create = await post(bucket, "/api/v1/plaza/posts", { channel: "c", topic: "t", board_kind: "guide", body: "b", post_id: rootId, thread_id: rootId });
    expect(create.status).toBe(201);

    const res = await post(bucket, `/api/v1/plaza/threads/${rootId}/resolution`, { action: "resolve", note: "gas exchange fixed it" });
    expect(res.status).toBe(201);

    const view = (await (await get(bucket, `/api/v1/plaza/threads/${rootId}`)).json()) as {
      resolution: { resolved: boolean; note?: string };
    };
    expect(view.resolution.resolved).toBe(true);
    expect(view.resolution.note).toBe("gas exchange fixed it");
  });

  it("non-owner gets 403 FORBIDDEN", async () => {
    const bucket = new FakeR2Bucket();
    const rootId = ulid(1000);
    // seeded with a different actor than the DEV_TOKEN session principal.
    await seedPost(bucket, { postId: rootId, threadId: rootId, actorId: "someone-else" });
    const res = await post(bucket, `/api/v1/plaza/threads/${rootId}/resolution`, { action: "resolve" });
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "FORBIDDEN" });
  });

  it("unresolve appends a new event (undo) without deleting the resolve event", async () => {
    const bucket = new FakeR2Bucket();
    const rootId = ulid(1000);
    await post(bucket, "/api/v1/plaza/posts", { channel: "c", topic: "t", board_kind: "guide", body: "b", post_id: rootId, thread_id: rootId });
    await post(bucket, `/api/v1/plaza/threads/${rootId}/resolution`, { action: "resolve" });
    const objectsAfterResolve = [...bucket.objects.keys()].filter((k) => k.includes("plaza.resolution")).length;
    await post(bucket, `/api/v1/plaza/threads/${rootId}/resolution`, { action: "unresolve" });
    const objectsAfterUnresolve = [...bucket.objects.keys()].filter((k) => k.includes("plaza.resolution")).length;
    expect(objectsAfterUnresolve).toBe(objectsAfterResolve + 1); // appended, not overwritten

    const view = (await (await get(bucket, `/api/v1/plaza/threads/${rootId}`)).json()) as { resolution: { resolved: boolean } };
    expect(view.resolution.resolved).toBe(false);
  });

  it("404 on unknown thread; 400 on invalid action", async () => {
    const bucket = new FakeR2Bucket();
    const missing = await post(bucket, "/api/v1/plaza/threads/NOPE/resolution", { action: "resolve" });
    expect(missing.status).toBe(404);

    const rootId = ulid(1000);
    await post(bucket, "/api/v1/plaza/posts", { channel: "c", topic: "t", board_kind: "guide", body: "b", post_id: rootId, thread_id: rootId });
    const bad = await post(bucket, `/api/v1/plaza/threads/${rootId}/resolution`, { action: "delete" });
    expect(bad.status).toBe(400);
  });

  it("route is protected (401 without auth)", async () => {
    const res = await app.request("/api/v1/plaza/threads/x/resolution", { method: "POST", body: "{}" }, makeEnv());
    expect(res.status).toBe(401);
  });
});

describe("OQ-PLZ-01 promotion status (thresholds 4/2/5/12)", () => {
  it("open by default (no cite/retry/stance)", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    const threadId = "KT-OPEN";
    await seedPost(bucket, { postId: threadId, threadId, actorId: "owner" });
    const p = await projectPromotionStatus(s, threadId);
    expect(p).toMatchObject({ status: "open", cite_count: 0, retry_reproduced: 0, retry_not_reproduced: 0 });
  });

  it("verified once cite>=VERIFIED_CITE_MIN and reproduced>=VERIFIED_RETRY_MIN", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    const threadId = "KT-VERIFIED";
    const citeRefs = Array.from({ length: PLZ_VERIFIED_CITE_MIN }, (_, i) => ({ type: "observation", id: `OBS-${i}` }));
    await seedPost(bucket, { postId: threadId, threadId, actorId: "owner", citeRefs });
    for (let i = 0; i < PLZ_VERIFIED_RETRY_MIN; i++) await seedRetrySignal(bucket, threadId, "retry_reproduced", `r${i}`);
    const p = await projectPromotionStatus(s, threadId);
    expect(p.status).toBe("verified");
    expect(p.cite_count).toBe(PLZ_VERIFIED_CITE_MIN);
    expect(p.retry_reproduced).toBe(PLZ_VERIFIED_RETRY_MIN);
  });

  it("refuted overrides verified once not-reproduced count crosses REFUTED_RETRY_MIN (downgrade wins)", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    const threadId = "KT-REFUTED";
    const citeRefs = Array.from({ length: PLZ_VERIFIED_CITE_MIN }, (_, i) => ({ type: "observation", id: `OBS-${i}` }));
    await seedPost(bucket, { postId: threadId, threadId, actorId: "owner", citeRefs });
    for (let i = 0; i < PLZ_VERIFIED_RETRY_MIN; i++) await seedRetrySignal(bucket, threadId, "retry_reproduced", `r${i}`);
    for (let i = 0; i < PLZ_REFUTED_RETRY_MIN; i++) await seedRetrySignal(bucket, threadId, "retry_not_reproduced", `n${i}`);
    const p = await projectPromotionStatus(s, threadId);
    expect(p.status).toBe("refuted"); // even though verified thresholds are also met
  });

  it("unresolved once stance total >= UNRESOLVED_STANCE_MIN and neither verified nor refuted", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    const threadId = "KT-UNRESOLVED";
    await seedPost(bucket, { postId: threadId, threadId, actorId: "owner" });
    for (let i = 0; i < PLZ_UNRESOLVED_STANCE_MIN; i++) await seedStance(bucket, threadId, `v${i}`, i % 2 === 0 ? "agree" : "disagree");
    const p = await projectPromotionStatus(s, threadId);
    expect(p.status).toBe("unresolved");
    expect(p.stance_total).toBe(PLZ_UNRESOLVED_STANCE_MIN);
  });

  it("duplicate observation cite_refs across replies count once (Set dedup)", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    const threadId = "KT-DEDUP";
    await seedPost(bucket, { postId: threadId, threadId, actorId: "owner", citeRefs: [{ type: "observation", id: "OBS-SAME" }] });
    await seedPost(bucket, { postId: ulid(2000), threadId, actorId: "someone", citeRefs: [{ type: "observation", id: "OBS-SAME" }] });
    const p = await projectPromotionStatus(s, threadId);
    expect(p.cite_count).toBe(1);
  });

  it("is surfaced on GET /plaza/threads/:thread_id", async () => {
    const bucket = new FakeR2Bucket();
    const rootId = ulid(1000);
    await post(bucket, "/api/v1/plaza/posts", { channel: "c", topic: "t", board_kind: "guide", body: "b", post_id: rootId, thread_id: rootId });
    const view = (await (await get(bucket, `/api/v1/plaza/threads/${rootId}`)).json()) as { promotion: { status: string } };
    expect(view.promotion.status).toBe("open");
  });
});

describe("OQ-PLZ-02 weighted consensus (projectConsensus actorWeights)", () => {
  it("default (no weights) is unchanged — backward compatible with unweighted callers", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    await seedStance(bucket, "ST-W", "a0", "agree");
    await seedStance(bucket, "ST-W", "a1", "agree");
    await seedStance(bucket, "ST-W", "d0", "disagree");
    const [row] = await projectConsensus(s, ["ST-W"]);
    expect(row).toMatchObject({ agree: 2, disagree: 1, pass: 0 });
  });

  it("a weighted actor's vote counts as its weight, not 1 (OQ-PLZ-02 = 2.0/1.5 initial values)", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    await seedStance(bucket, "ST-W2", "certified-breeder", "agree");
    await seedStance(bucket, "ST-W2", "plain-user", "disagree");
    const [row] = await projectConsensus(s, ["ST-W2"], { "certified-breeder": PLZ_VOTE_WEIGHT_CERTIFIED_BREEDER });
    expect(row.agree).toBe(PLZ_VOTE_WEIGHT_CERTIFIED_BREEDER); // 2.0, not 1
    expect(row.disagree).toBe(1); // unweighted actor defaults to 1
  });
});

describe("dev actor id helper sanity", () => {
  it("DEV_TOKEN session principal is deriveActorId('dev@ihl.local')", async () => {
    const expected = await deriveActorId("dev@ihl.local");
    const bucket = new FakeR2Bucket();
    const rootId = ulid(1000);
    await post(bucket, "/api/v1/plaza/posts", { channel: "c", topic: "t", board_kind: "guide", body: "b", post_id: rootId, thread_id: rootId });
    const detail = (await (await get(bucket, `/api/v1/plaza/posts/${rootId}`)).json()) as { post: { actor_id: string } };
    expect(detail.post.actor_id).toBe(expected);
  });
});
