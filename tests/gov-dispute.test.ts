// Dispute 二人部屋 TC(design-c5.md §K6 §4 / V3-GOV-01)。open→message→close の状態遷移・participants は
// opener/respondent の2名限定(第三者 message を 403)・close なしで TTL 超過→expired:true・
// 不服申立 route は不在。it 名は ASCII。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, ulid, deriveActorId } from "@ihl/truth";
import { issueSessionToken } from "../apps/api/src/session";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}
const authOf = async (actor: string) => bearer(await issueSessionToken(actor, "test-session-secret", []));

const DISPUTE_TYPE = "ihl.gov.dispute.v1";
const DISPUTE_SCHEMA = "schemas/events/gov-dispute.schema.json";

function openDispute(env: ReturnType<typeof makeEnv>, body: Record<string, unknown>) {
  return app.request("/api/v1/gov/disputes", { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(body) }, env);
}
function sendMessage(env: ReturnType<typeof makeEnv>, id: string, body: Record<string, unknown>) {
  return app.request(`/api/v1/gov/disputes/${id}/messages`, { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(body) }, env);
}
async function getDispute(env: ReturnType<typeof makeEnv>, id: string) {
  return app.request(`/api/v1/gov/disputes/${id}`, { headers: AUTH_HEADERS }, env);
}
// dispute open event を投影入力として直接 seed(opener/respondent と opened_at を任意に置く)。
async function seedOpen(bucket: FakeR2Bucket, disputeId: string, opener: string, respondent: string, createdAt: string) {
  const eid = ulid();
  await new TruthStore(bucket).putEventAt(`truth/${DISPUTE_TYPE}/${disputeId}/${eid}.json`, {
    specversion: "1.0",
    id: eid,
    source: "test",
    type: DISPUTE_TYPE,
    time: createdAt,
    dataschema: DISPUTE_SCHEMA,
    provenance: { generator_kind: "human", actor_id: opener },
    data: { dispute_id: disputeId, actor_id: opener, action: "open", category: "board", respondent_id: respondent, created_at: createdAt, schema_version: "1" },
  });
}

describe("gov dispute two-person room (GOV-01)", () => {
  it("projects open -> message -> close state transitions", async () => {
    const env = makeEnv();
    const opened = (await (await openDispute(env, { category: "board", respondent_id: "bob" })).json()) as { dispute_id: string };
    const id = opened.dispute_id;

    const mid = await sendMessage(env, id, { body: "let us settle this" });
    expect(mid.status).toBe(201);

    const closeRes = await app.request(
      `/api/v1/gov/disputes/${id}/close`,
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ title: "settled", summary: "both agreed" }) },
      env,
    );
    expect(closeRes.status).toBe(201);

    const view = (await (await getDispute(env, id)).json()) as {
      status: string;
      messages: unknown[];
      participants: { opener: string; respondent: string };
    };
    expect(view.status).toBe("resolved");
    expect(view.messages.length).toBe(1);
    expect(view.participants.respondent).toBe("bob");
  });

  it("rejects a message from a third party with 403", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    // opener/respondent are neither the DEV principal -> the authed sender is a third party.
    await seedOpen(bucket, "d-third", "alice", "carol", new Date().toISOString());
    const res = await sendMessage(env, "d-third", { body: "i am not a party" });
    expect(res.status).toBe(403);
  });

  it("allows the respondent to post a message", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const dev = await deriveActorId("dev@ihl.local");
    await seedOpen(bucket, "d-resp", "alice", dev, new Date().toISOString());
    const res = await sendMessage(env, "d-resp", { body: "responding" });
    expect(res.status).toBe(201);
  });

  it("marks an unclosed dispute past the TTL as expired", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const past = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(); // 20d > DISPUTE_TTL_DAYS(14)
    await seedOpen(bucket, "d-old", "alice", "bob", past);
    await seedOpen(bucket, "d-new", "alice", "bob", new Date().toISOString());

    const oldView = (await (await getDispute(env, "d-old")).json()) as { expired: boolean; status: string };
    const newView = (await (await getDispute(env, "d-new")).json()) as { expired: boolean; status: string };
    expect(oldView.status).toBe("open");
    expect(oldView.expired).toBe(true);
    expect(newView.expired).toBe(false);
  });

  it("has no appeal route (unknown path 404s)", async () => {
    const env = makeEnv();
    const opened = (await (await openDispute(env, { category: "board", respondent_id: "bob" })).json()) as { dispute_id: string };
    const res = await app.request(
      `/api/v1/gov/disputes/${opened.dispute_id}/appeal`,
      { method: "POST", headers: AUTH_HEADERS, body: "{}" },
      env,
    );
    expect(res.status).toBe(404);
  });
});

describe("gov dispute route is protected", () => {
  it("returns 401 unauthenticated", async () => {
    const env = makeEnv();
    const r = await app.request("/api/v1/gov/disputes", { method: "POST", body: "{}" }, env);
    expect(r.status).toBe(401);
  });
});

// V3-BBS-06/08 移植(R64-1・plaza-dispute-routes.ts 削除に伴うテスト移植・元
// tests/plaza-dispute.test.ts「cannot dispute one's own post, opens a two-party room otherwise」
// 「requires tag and reason」相当)。category="board" + target_type/target_id で category="board"
// に相乗り(bridgeplan J1-1)。tag/reason 必須は gov-dispute.schema.json(additionalProperties:false・
// bridge2 排他)に該当フィールドが無いため移植していない(判断が要った箇所として報告書に明記)。
describe("V3-BBS-06/08 board dispute via /gov/disputes category=board (migrated from plaza-dispute-routes.ts)", () => {
  it("cannot dispute one's own post (target_type=post derives respondent from the post author)", async () => {
    const env = makeEnv();
    const authorH = await authOf("bbs-author-self");
    const post = (await (
      await app.request(
        "/api/v1/plaza/posts",
        { method: "POST", headers: authorH, body: JSON.stringify({ channel: "c", board_kind: "guide", topic: "t", body: "own post" }) },
        env,
      )
    ).json()) as { post_id: string };

    const own = await app.request(
      "/api/v1/gov/disputes",
      { method: "POST", headers: authorH, body: JSON.stringify({ category: "board", target_id: post.post_id }) },
      env,
    );
    expect(own.status).toBe(400);
    expect((await own.json()) as { error: string }).toMatchObject({ error: "CANNOT_DISPUTE_OWN_POST" });
  });

  it("opens a two-party room against another actor's post (respondent derived, not caller-supplied)", async () => {
    const env = makeEnv();
    const authorH = await authOf("bbs-author");
    const disputerH = await authOf("bbs-disputer");
    const post = (await (
      await app.request(
        "/api/v1/plaza/posts",
        { method: "POST", headers: authorH, body: JSON.stringify({ channel: "c", board_kind: "guide", topic: "t", body: "disputed post" }) },
        env,
      )
    ).json()) as { post_id: string };

    const opened = await app.request(
      "/api/v1/gov/disputes",
      { method: "POST", headers: disputerH, body: JSON.stringify({ category: "board", target_id: post.post_id }) },
      env,
    );
    expect(opened.status).toBe(201);
    const { dispute_id } = (await opened.json()) as { dispute_id: string };

    const view = (await (
      await app.request(`/api/v1/gov/disputes/${dispute_id}`, { headers: disputerH }, env)
    ).json()) as { participants: { opener: string; respondent: string }; category: string; subject_ref: { type: string; id: string } | null };
    expect(view.participants.opener).toBe("bbs-disputer");
    expect(view.participants.respondent).toBe("bbs-author");
    expect(view.category).toBe("board");
    expect(view.subject_ref).toEqual({ type: "post", id: post.post_id });
  });

  it("404s when the disputed post does not exist", async () => {
    const env = makeEnv();
    const disputerH = await authOf("bbs-disputer-404");
    const res = await app.request(
      "/api/v1/gov/disputes",
      { method: "POST", headers: disputerH, body: JSON.stringify({ category: "board", target_id: "no-such-post" }) },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("target_type=rating requires an explicit respondent_id (this file does not own market-rating data)", async () => {
    const env = makeEnv();
    const disputerH = await authOf("bbs-rating-disputer");

    const missing = await app.request(
      "/api/v1/gov/disputes",
      { method: "POST", headers: disputerH, body: JSON.stringify({ category: "board", target_type: "rating", target_id: "rating-1" }) },
      env,
    );
    expect(missing.status).toBe(400);

    const ok = await app.request(
      "/api/v1/gov/disputes",
      {
        method: "POST",
        headers: disputerH,
        body: JSON.stringify({ category: "board", target_type: "rating", target_id: "rating-1", respondent_id: "rated-user" }),
      },
      env,
    );
    expect(ok.status).toBe(201);
    const { dispute_id } = (await ok.json()) as { dispute_id: string };
    const view = (await (
      await app.request(`/api/v1/gov/disputes/${dispute_id}`, { headers: disputerH }, env)
    ).json()) as { participants: { respondent: string }; subject_ref: { type: string; id: string } | null };
    expect(view.participants.respondent).toBe("rated-user");
    expect(view.subject_ref).toEqual({ type: "market_rating", id: "rating-1" });
  });

  // W3-06 恒久策(a): respondent_id 形式検証。本番実体は deriveActorId() の sha256 hex 64。
  it("accepts the production-shaped respondent_id (sha256 hex 64) and round-trips it", async () => {
    const env = makeEnv();
    const respondent = await deriveActorId("respondent@example.test");
    expect(respondent).toMatch(/^[0-9a-f]{64}$/); // 前提の固定: 本番の実体は hex64
    const res = await openDispute(env, { category: "market", respondent_id: respondent });
    expect(res.status).toBe(201);
    const { dispute_id } = (await res.json()) as { dispute_id: string };
    const view = (await (await getDispute(env, dispute_id)).json()) as { participants: { respondent: string } };
    expect(view.participants.respondent).toBe(respondent);
  });

  it("keeps accepting hyphenated ids used by dev seed and existing fixtures", async () => {
    const env = makeEnv();
    for (const id of ["e2e-buyer", "gov10-board-respondent", "rated-user"]) {
      const res = await openDispute(env, { category: "market", respondent_id: id });
      expect(res.status).toBe(201);
    }
  });

  it("rejects malformed respondent_id (separator / control char / oversize) with 400", async () => {
    const env = makeEnv();
    const bad = [
      "../../etc/passwd", // path separator
      "truth/ihl.gov.dispute.v1", // key-shaped
      "bob\nX-Injected: 1", // control char
      "a".repeat(129), // over the 128 cap
    ];
    for (const id of bad) {
      const res = await openDispute(env, { category: "market", respondent_id: id });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("INVALID_DISPUTE");
    }
  });
});
