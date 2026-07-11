// Consensus TC(design-c5.md §K6 §4 / V3-BBS-36)。Agree/Disagree/Pass を append-only 収集・同 actor
// の再投票は最新 ULID を latest に採用(上書きせず追記)・consensus/divisive は §2.5 閾値の
// 純算術で決定論分類(クラスタリング/LLM なし=同入力同出力)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, ulid } from "@ihl/truth";
import { projectConsensus } from "../apps/api/src/plaza-routes";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

const STANCE_TYPE = "ihl.plaza.stance.v1";
const STANCE_SCHEMA = "schemas/events/plaza-stance.schema.json";

// stance を明示 actor_id / stance_id で直接 append(route は dev actor 固定のため多 actor は
// TruthStore 直挿しで用意する)。
async function seedStance(bucket: FakeR2Bucket, statementId: string, actorId: string, value: string, stanceId = ulid()) {
  const iso = new Date().toISOString();
  await new TruthStore(bucket).putEventAt(`truth/${STANCE_TYPE}/${statementId}/${stanceId}.json`, {
    specversion: "1.0",
    id: stanceId,
    source: "test",
    type: STANCE_TYPE,
    time: iso,
    dataschema: STANCE_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data: { stance_id: stanceId, actor_id: actorId, statement_id: statementId, value, created_at: iso, schema_version: "1" },
  });
}

describe("POST /api/v1/plaza/stances + consensus projection (BBS-36)", () => {
  it("appends a stance and counts it in the thread consensus", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const rootId = ulid(1000);
    await app.request(
      "/api/v1/plaza/posts",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ channel: "c", topic: "t", board_kind: "guide", body: "b", post_id: rootId, thread_id: rootId }) },
      env,
    );
    const stance = await app.request(
      "/api/v1/plaza/stances",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ statement_id: rootId, value: "agree" }) },
      env,
    );
    expect(stance.status).toBe(201);

    const res = await app.request(`/api/v1/plaza/threads/${rootId}/consensus`, { headers: AUTH_HEADERS }, env);
    const { statements } = (await res.json()) as { statements: { statement_id: string; agree: number }[] };
    expect(statements.find((s) => s.statement_id === rootId)!.agree).toBe(1);
  });

  it("adopts the latest ULID as the actor's current stance (append-only, no overwrite)", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    // same actor votes agree then (later ULID) disagree
    await seedStance(bucket, "ST-1", "actor-a", "agree", ulid(1000));
    await seedStance(bucket, "ST-1", "actor-a", "disagree", ulid(2000));
    const [row] = await projectConsensus(s, ["ST-1"]);
    expect(row.agree).toBe(0);
    expect(row.disagree).toBe(1);
    expect(row.pass).toBe(0);
  });

  it("classifies consensus / divisive by pure arithmetic thresholds", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    // ST-CONSENSUS: 5 agree, 0 disagree -> consensus true, divisive false
    for (let i = 0; i < 5; i++) await seedStance(bucket, "ST-CONSENSUS", `a${i}`, "agree");
    // ST-DIVISIVE: 3 agree, 2 disagree (n=5) -> consensus true (0.6) AND divisive true (0.4>=0.3)
    for (let i = 0; i < 3; i++) await seedStance(bucket, "ST-DIVISIVE", `a${i}`, "agree");
    for (let i = 0; i < 2; i++) await seedStance(bucket, "ST-DIVISIVE", `d${i}`, "disagree");
    // ST-FEW: 2 agree only (n=2 < CONSENSUS_MIN_VOTES) -> neither
    for (let i = 0; i < 2; i++) await seedStance(bucket, "ST-FEW", `a${i}`, "agree");

    const rows = await projectConsensus(s, ["ST-CONSENSUS", "ST-DIVISIVE", "ST-FEW"]);
    const by = Object.fromEntries(rows.map((r) => [r.statement_id, r]));
    expect(by["ST-CONSENSUS"]).toMatchObject({ agree: 5, disagree: 0, consensus: true, divisive: false });
    expect(by["ST-DIVISIVE"]).toMatchObject({ agree: 3, disagree: 2, consensus: true, divisive: true });
    expect(by["ST-FEW"]).toMatchObject({ consensus: false, divisive: false });
  });

  it("is deterministic — same stance set yields identical projection (LLM-free)", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    for (let i = 0; i < 4; i++) await seedStance(bucket, "ST-D", `a${i}`, "agree");
    await seedStance(bucket, "ST-D", "d0", "disagree");
    const first = await projectConsensus(s, ["ST-D"]);
    const second = await projectConsensus(s, ["ST-D"]);
    expect(second).toEqual(first);
  });
});

describe("plaza stance route is protected", () => {
  it("returns 401 unauthenticated", async () => {
    const env = makeEnv();
    const r = await app.request("/api/v1/plaza/stances", { method: "POST", body: "{}" }, env);
    expect(r.status).toBe(401);
  });
});
