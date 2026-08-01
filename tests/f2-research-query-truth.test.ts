// g81-f2wiring T4(R0801-73be3e §7-1申し送り): F2研究者モードの検索条件JSON保存
// (ihl.research.query.v1)。業務ルールを持たない単純append のため、既存 POST /events
// 自己サービス経路(apps/api/src/index.ts SELF_SERVICE_EVENT_TYPES)に乗せた
// — ihl.ui.vote.v1/ihl.process.intent.v1(tests/intent.test.ts)と同型のテスト。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, ulid, deriveActorId } from "@ihl/truth";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const AUTH = { Authorization: `Bearer ${DEV_TOKEN}`, "content-type": "application/json" };
const DEV_ACTOR = await deriveActorId("dev@ihl.local");
const EVENT_TYPE = "ihl.research.query.v1";

function researchQueryEnvelope(overrides: Record<string, unknown> = {}) {
  const queryId = ulid();
  return {
    specversion: "1.0",
    id: ulid(),
    source: "apps/web",
    type: EVENT_TYPE,
    time: new Date().toISOString(),
    dataschema: "schemas/events/research-query.schema.json",
    provenance: { generator_kind: "human", actor_id: DEV_ACTOR },
    data: {
      query_id: queryId,
      actor_id: DEV_ACTOR,
      manifest_generation: 3,
      query: { conditions: [{ column: "type", operator: "=", value: "obs-capture" }], limit: 100 },
      created_at: new Date().toISOString(),
    },
    ...overrides,
  };
}

describe("g81-f2wiring T4 — POST /events ihl.research.query.v1 (self-service allowlist)", () => {
  it("inserts once, converges to truth/ihl.research.query.v1/<envelope.id>.json, and 409s on the same id", async () => {
    const env = makeEnv();
    const envelope = researchQueryEnvelope();

    const first = await app.request("/events", { method: "POST", headers: AUTH, body: JSON.stringify(envelope) }, env);
    expect(first.status).toBe(201);
    expect((await first.json()).key).toBe(`truth/${EVENT_TYPE}/${envelope.id}.json`);

    const second = await app.request("/events", { method: "POST", headers: AUTH, body: JSON.stringify(envelope) }, env);
    expect(second.status).toBe(409);
  });

  it("stamps provenance.actor_id from the session principal (not a client-supplied value)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const envelope = researchQueryEnvelope({
      provenance: { generator_kind: "human", actor_id: "someone-else-entirely" },
    });

    const res = await app.request("/events", { method: "POST", headers: AUTH, body: JSON.stringify(envelope) }, env);
    expect(res.status).toBe(201);
    const stored = await new TruthStore(bucket).readEvent(`truth/${EVENT_TYPE}/${envelope.id}.json`);
    expect((stored?.provenance as { actor_id?: string })?.actor_id).toBe(DEV_ACTOR);
  });

  it("rejects data missing a required field (manifest_generation) — schema validation actually fires", async () => {
    const env = makeEnv();
    const envelope = researchQueryEnvelope();
    const data = envelope.data as Record<string, unknown>;
    delete data.manifest_generation;

    const res = await app.request("/events", { method: "POST", headers: AUTH, body: JSON.stringify(envelope) }, env);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_ENVELOPE");
  });

  it("round-trips the query JSON verbatim (再現性100%の実体: 保存した条件をそのまま読める)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const envelope = researchQueryEnvelope();

    await app.request("/events", { method: "POST", headers: AUTH, body: JSON.stringify(envelope) }, env);
    const stored = await new TruthStore(bucket).readEvent(`truth/${EVENT_TYPE}/${envelope.id}.json`);
    expect(stored?.data).toEqual(envelope.data);
  });
});
