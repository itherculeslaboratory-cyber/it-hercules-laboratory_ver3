// Fork / rank TC(design-c5.md §K6 §4 / V3-BBS-29/GOV-19/23)。public→beginner 自動・gov.vote
// (kind=fork_rank)approve で昇降・FORK_RANKS 表示順・minor は search=false 除外/true 出現・
// 全 fork 非削除共存(private も readFork では残る)・content_hash 改変検知。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, ulid } from "@ihl/truth";
import { sha256Hex } from "../apps/api/src/plaza-routes";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

const VOTE_TYPE = "ihl.gov.vote.v1";
const VOTE_SCHEMA = "schemas/events/gov-vote.schema.json";

function postFork(env: ReturnType<typeof makeEnv>, body: Record<string, unknown>) {
  return app.request("/api/v1/plaza/forks", { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(body) }, env);
}
function fork(overrides: Record<string, unknown> = {}) {
  return { target_type: "component", forked_from: "root", visibility: "public", title: "a fork", ...overrides };
}
async function getForks(env: ReturnType<typeof makeEnv>, query = "") {
  const res = await app.request(`/api/v1/plaza/forks${query}`, { headers: AUTH_HEADERS }, env);
  return ((await res.json()) as { forks: { fork_id: string; rank: string }[] }).forks;
}
// gov.vote は K6-gov 側 route が書く。ここでは投影の入力として TruthStore に直接 seed する。
async function seedForkRankVote(bucket: FakeR2Bucket, forkId: string, rankTo: string, voteId = ulid()) {
  const iso = new Date().toISOString();
  await new TruthStore(bucket).putEventAt(`truth/${VOTE_TYPE}/${forkId}/${voteId}.json`, {
    specversion: "1.0",
    id: voteId,
    source: "test",
    type: VOTE_TYPE,
    time: iso,
    dataschema: VOTE_SCHEMA,
    provenance: { generator_kind: "human", actor_id: "voter" },
    data: { vote_id: voteId, actor_id: "voter", kind: "fork_rank", proposal_target: forkId, value: "approve", rank_to: rankTo, created_at: iso, schema_version: "1" },
  });
}

describe("POST /api/v1/plaza/forks + rank projection (BBS-29)", () => {
  it("lists a public fork at rank=beginner by default and hides a private fork", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const pub = (await (await postFork(env, fork())).json()) as { fork_id: string };
    const priv = (await (await postFork(env, fork({ visibility: "private", title: "hidden" }))).json()) as { fork_id: string };

    const forks = await getForks(env);
    expect(forks.find((f) => f.fork_id === pub.fork_id)!.rank).toBe("beginner");
    expect(forks.some((f) => f.fork_id === priv.fork_id)).toBe(false);

    // non-deletion: the private fork still exists and is readable directly
    const detail = await app.request(`/api/v1/plaza/forks/${priv.fork_id}`, { headers: AUTH_HEADERS }, env);
    expect(detail.status).toBe(200);
  });

  it("promotes a fork's effective rank via the latest approved fork_rank vote", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const f = (await (await postFork(env, fork())).json()) as { fork_id: string };
    await seedForkRankVote(bucket, f.fork_id, "recommended");
    const forks = await getForks(env);
    expect(forks.find((x) => x.fork_id === f.fork_id)!.rank).toBe("recommended");
  });

  it("orders forks by the FORK_RANKS display order", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const rec = (await (await postFork(env, fork({ title: "rec" }))).json()) as { fork_id: string };
    const off = (await (await postFork(env, fork({ title: "off" }))).json()) as { fork_id: string };
    const beg = (await (await postFork(env, fork({ title: "beg" }))).json()) as { fork_id: string };
    await seedForkRankVote(bucket, rec.fork_id, "recommended");
    await seedForkRankVote(bucket, off.fork_id, "official");
    // beg stays beginner (no vote)

    const forks = await getForks(env);
    const order = forks.map((f) => f.fork_id);
    expect(order.indexOf(off.fork_id)).toBeLessThan(order.indexOf(rec.fork_id));
    expect(order.indexOf(rec.fork_id)).toBeLessThan(order.indexOf(beg.fork_id));
  });

  it("excludes minor forks unless search=true", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const f = (await (await postFork(env, fork())).json()) as { fork_id: string };
    await seedForkRankVote(bucket, f.fork_id, "minor");

    const listed = await getForks(env);
    expect(listed.some((x) => x.fork_id === f.fork_id)).toBe(false);
    const searched = await getForks(env, "?search=true");
    expect(searched.some((x) => x.fork_id === f.fork_id)).toBe(true);
  });

  it("keeps content_hash for change detection (tampered content mismatches)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const hash = await sha256Hex("fork-content-v1");
    const created = (await (await postFork(env, fork({ content_hash: hash }))).json()) as { fork_id: string };
    const detail = (await (await app.request(`/api/v1/plaza/forks/${created.fork_id}`, { headers: AUTH_HEADERS }, env)).json()) as {
      fork: { content_hash: string };
    };
    expect(detail.fork.content_hash).toBe(hash);
    expect(await sha256Hex("fork-content-v1")).toBe(detail.fork.content_hash);
    expect(await sha256Hex("fork-content-TAMPERED")).not.toBe(detail.fork.content_hash);
  });
});

describe("plaza fork route is protected", () => {
  it("returns 401 unauthenticated", async () => {
    const env = makeEnv();
    const r = await app.request("/api/v1/plaza/forks", { method: "POST", body: "{}" }, env);
    expect(r.status).toBe(401);
  });
});
