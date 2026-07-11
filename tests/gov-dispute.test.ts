// Dispute 二人部屋 TC(design-c5.md §K6 §4 / V3-GOV-01)。open→message→close の状態遷移・participants は
// opener/respondent の2名限定(第三者 message を 403)・close なしで TTL 超過→expired:true・
// 不服申立 route は不在。it 名は ASCII。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, ulid, deriveActorId } from "@ihl/truth";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

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
