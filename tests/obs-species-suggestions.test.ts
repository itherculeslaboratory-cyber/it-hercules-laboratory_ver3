// V3-OBS-57 種候補提案チェーン TC (design-k1 §2). ヒューリスティック→CLIP(任意)→
// Vision(任意)の順・CLIP/Vision未設定でも必ず完走(劣化運用を明示)・種の自動確定はしない。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { ulid } from "@ihl/truth";
import { suggestSpeciesCandidates, heuristicSpeciesCandidatesFromVector } from "../apps/api/src/observation-routes";
import { TruthStore } from "@ihl/truth";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const AUTH = { Authorization: `Bearer ${DEV_TOKEN}` };
const AUTH_JSON = { ...AUTH, "content-type": "application/json" };

function ctx() {
  const bucket = new FakeR2Bucket();
  return { bucket, env: makeEnv(bucket) };
}
async function post(path: string, body: unknown, env: object) {
  return app.request(path, { method: "POST", headers: AUTH_JSON, body: JSON.stringify(body) }, env);
}
async function get(path: string, env: object) {
  return app.request(path, { headers: AUTH }, env);
}

function vec384(components: Record<number, number>): Float32Array {
  const v = new Float32Array(384);
  for (const [i, x] of Object.entries(components)) v[Number(i)] = x;
  return v;
}
async function seedCapture(
  bucket: FakeR2Bucket,
  env: object,
  spec: { id: string; species_candidate?: string; species_confirmed_by?: string; vec?: Float32Array },
) {
  const res = await post(
    "/api/v1/observation/captures",
    { capture_id: spec.id, domain: "biology", species_candidate: spec.species_candidate, species_confirmed_by: spec.species_confirmed_by },
    env,
  );
  expect(res.status).toBe(202);
  if (spec.vec) {
    const file = `embeddings/bin/${spec.id}.bin`;
    await bucket.put(`embeddings/manifest/${spec.id}.json`, JSON.stringify({ capture_id: spec.id, embedding_dim: spec.vec.length, embedding_file: file, vector_offset: 0 }));
    await bucket.put(file, spec.vec);
  }
}

describe("OBS-57 suggestSpeciesCandidates (pure chain contract)", () => {
  it("heuristic candidates present -> used as-is, no escalation, no degraded flags", async () => {
    const result = await suggestSpeciesCandidates([{ species: "Dynastes hercules", score: 0.9, method: "heuristic" }]);
    expect(result.method_used).toBe("heuristic");
    expect(result.degraded).toEqual([]);
    expect(result.candidates).toHaveLength(1);
  });

  it("no heuristic match + neither clip nor vision configured -> completes with empty candidates + explicit degraded flags", async () => {
    const result = await suggestSpeciesCandidates([]);
    expect(result.candidates).toEqual([]);
    expect(result.degraded).toEqual(["heuristic_no_match", "clip_not_configured", "vision_not_configured"]);
  });

  it("no heuristic match, clip configured and returns candidates -> escalates to clip", async () => {
    const result = await suggestSpeciesCandidates([], {
      clip: async () => [{ species: "Clip Species", score: 0.5, method: "clip" }],
    });
    expect(result.method_used).toBe("clip");
    expect(result.candidates[0].species).toBe("Clip Species");
    expect(result.degraded).toEqual(["heuristic_no_match"]);
  });

  it("clip configured but empty, vision configured and returns candidates -> escalates to vision", async () => {
    const result = await suggestSpeciesCandidates([], {
      clip: async () => [],
      vision: async () => [{ species: "Vision Species", score: 0.3, method: "vision" }],
    });
    expect(result.method_used).toBe("vision");
    expect(result.degraded).toEqual(["heuristic_no_match", "clip_no_match"]);
  });

  it("clip and vision both configured but unavailable (null) -> completes empty with all degraded flags recorded", async () => {
    const result = await suggestSpeciesCandidates([], { clip: async () => null, vision: async () => null });
    expect(result.candidates).toEqual([]);
    expect(result.degraded).toEqual(["heuristic_no_match", "clip_no_match", "vision_no_match"]);
  });
});

describe("OBS-57 heuristicSpeciesCandidatesFromVector (real embedding-neighbor reuse)", () => {
  it("proposes the species of the nearest user-confirmed neighbor, excludes self, ignores unconfirmed candidates", async () => {
    const { bucket, env } = ctx();
    const query = ulid();
    const confirmedNear = ulid();
    const confirmedFar = ulid();
    const unconfirmed = ulid();
    await seedCapture(bucket, env, { id: query, vec: vec384({ 0: 1 }) });
    await seedCapture(bucket, env, { id: confirmedNear, species_candidate: "Dynastes hercules", species_confirmed_by: "user", vec: vec384({ 0: 1 }) });
    await seedCapture(bucket, env, { id: confirmedFar, species_candidate: "Other Species", species_confirmed_by: "user", vec: vec384({ 1: 1 }) });
    await seedCapture(bucket, env, { id: unconfirmed, species_candidate: "Should Not Appear", vec: vec384({ 0: 1 }) }); // no species_confirmed_by

    const s = new TruthStore(bucket);
    const queryVec = vec384({ 0: 1 });
    const candidates = await heuristicSpeciesCandidatesFromVector(s, bucket, queryVec, query);
    expect(candidates.map((c) => c.species)).toContain("Dynastes hercules");
    expect(candidates.map((c) => c.species)).not.toContain("Should Not Appear");
    expect(candidates[0].species).toBe("Dynastes hercules"); // nearest neighbor ranks first
    expect(candidates.every((c) => c.method === "heuristic")).toBe(true);
  });
});

describe("GET /observation/{capture_id}/species-suggestions route", () => {
  it("completes with heuristic-only result when no confirmed neighbors exist yet (cold start, CLIP/Vision unset by default)", async () => {
    const { bucket, env } = ctx();
    const id = ulid();
    await seedCapture(bucket, env, { id, vec: vec384({ 0: 1 }) });
    const res = await get(`/api/v1/observation/${id}/species-suggestions`, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidates: unknown[]; method_used: string; degraded: string[] };
    expect(body.method_used).toBe("heuristic");
    expect(body.candidates).toEqual([]);
    expect(body.degraded).toEqual(["heuristic_no_match", "clip_not_configured", "vision_not_configured"]);
  });

  it("proposes a real candidate once a confirmed neighbor exists", async () => {
    const { bucket, env } = ctx();
    const query = ulid();
    const neighbor = ulid();
    await seedCapture(bucket, env, { id: query, vec: vec384({ 0: 1 }) });
    await seedCapture(bucket, env, { id: neighbor, species_candidate: "Dynastes hercules", species_confirmed_by: "user", vec: vec384({ 0: 1 }) });
    const res = await get(`/api/v1/observation/${query}/species-suggestions`, env);
    const body = (await res.json()) as { candidates: { species: string }[]; method_used: string };
    expect(body.method_used).toBe("heuristic");
    expect(body.candidates[0].species).toBe("Dynastes hercules");
  });

  it("no embedding for the capture -> 404 QUERY_EMBEDDING_NOT_FOUND", async () => {
    const { env } = ctx();
    const id = ulid();
    await post("/api/v1/observation/captures", { capture_id: id, domain: "biology" }, env);
    const res = await get(`/api/v1/observation/${id}/species-suggestions`, env);
    expect(res.status).toBe(404);
  });

  it("unauthenticated -> 401 (deny-by-default)", async () => {
    const { env } = ctx();
    const res = await app.request("/api/v1/observation/x/species-suggestions", {}, env);
    expect(res.status).toBe(401);
  });
});
