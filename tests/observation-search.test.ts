// C3 §1: deterministic similarity ladder TC (V3-OBS-10 / CL-08). Drives the real
// app through the auth gate and seeds R2 with captures + frozen embedding
// manifests + one embeddings.bin (vector_offset projection). Covers:
//   - 3-stage determinism (same input → same ranking)
//   - 384 正常系 (cosine rank) + 768 遮断 (manifest dim ≠ 384 excluded)
//   - whitelist / subset ladder_stage
//   - unauthenticated → 401 ; query dim mismatch → 400
// capture_id must be a ULID (envelope.id pattern), so ids are generated and
// mapped to roles (a/b/c/d) rather than hard-coded strings.
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { ulid } from "@ihl/truth";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const JSON_HEADERS = { "content-type": "application/json" };
const AUTH = { Authorization: `Bearer ${DEV_TOKEN}` };
const AUTH_JSON = { ...AUTH, ...JSON_HEADERS };

async function post(path: string, body: unknown, env: object, headers = AUTH_JSON) {
  return app.request(path, { method: "POST", headers, body: JSON.stringify(body) }, env);
}

// 384-dim vector with the given index→value components (rest 0). Callers pass
// already-unit component sets so cosine against a unit query is exact/known.
function vec384(components: Record<number, number>): Float32Array {
  const v = new Float32Array(384);
  for (const [i, x] of Object.entries(components)) v[Number(i)] = x;
  return v;
}

type Ids = { a: string; b: string; c: string; d: string };

// Seed captures (via API) + one embeddings.bin holding all vectors at offsets +
// a per-capture manifest pointing into it. cap-d carries a 768-dim vector to
// prove the search-layer dim guard (CL-08) blocks it. Returns env + id map.
async function seed(): Promise<{ env: object; ids: Ids }> {
  const bucket = new FakeR2Bucket();
  const env = makeEnv(bucket);
  const ids: Ids = { a: ulid(), b: ulid(), c: ulid(), d: ulid() };

  const specs = [
    { id: ids.a, domain: "biology", vec: vec384({ 0: 1 }), measurements: [{ item: "len", kind: "number", value: 10 }] },
    { id: ids.b, domain: "biology", vec: vec384({ 0: 0.6, 1: 0.8 }), measurements: [{ item: "len", kind: "number", value: 50 }] },
    { id: ids.c, domain: "mineral", vec: vec384({ 1: 1 }), measurements: [{ item: "len", kind: "number", value: 99 }] },
    { id: ids.d, domain: "biology", vec: (() => { const v = new Float32Array(768); v[0] = 1; return v; })(), measurements: [] as unknown[] },
  ];

  for (const s of specs) {
    const res = await post("/api/v1/observation/captures", { capture_id: s.id, domain: s.domain, measurements: s.measurements }, env);
    expect(res.status).toBe(202);
  }

  // One embeddings.bin: concat all vectors; manifest.vector_offset locates each.
  const total = specs.reduce((n, s) => n + s.vec.length, 0);
  const bin = new Float32Array(total);
  let floatOffset = 0;
  for (const s of specs) {
    bin.set(s.vec, floatOffset);
    await bucket.put(
      `embeddings/manifest/${s.id}.json`,
      JSON.stringify({ capture_id: s.id, embedding_dim: s.vec.length, embedding_file: "embeddings/embeddings.bin", vector_offset: floatOffset * 4 }),
    );
    floatOffset += s.vec.length;
  }
  await bucket.put("embeddings/embeddings.bin", bin);
  return { env, ids };
}

describe("§1 embedding stage — 384 rank + 768 block", () => {
  it("ranks by cosine, excludes the 768-dim candidate (CL-08 guard), reports ladder_stage=embedding", async () => {
    const { env, ids } = await seed();
    const res = await post("/api/v1/observation/search", { query_vector: Array.from(vec384({ 0: 1 })), top_k: 10 }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ladder_stage: string; results: { capture_id: string; score: number }[] };
    expect(body.ladder_stage).toBe("embedding");
    // cap-d (768) blocked → only the three 384 captures remain, ranked by cosine.
    expect(body.results.map((r) => r.capture_id)).toEqual([ids.a, ids.b, ids.c]);
    expect(body.results[0].score).toBeCloseTo(1, 5);
    expect(body.results[1].score).toBeCloseTo(0.6, 5);
    expect(body.results[2].score).toBeCloseTo(0, 5);
  });

  it("is deterministic: same input → identical ranking twice", async () => {
    const { env, ids } = await seed();
    const q = { query_capture_id: ids.a };
    const a = (await (await post("/api/v1/observation/search", q, env)).json()) as { results: unknown };
    const b = (await (await post("/api/v1/observation/search", q, env)).json()) as { results: unknown };
    expect(a.results).toEqual(b.results);
  });

  it("query_vector of the wrong dimension → 400 (384 一本化)", async () => {
    const { env } = await seed();
    const res = await post("/api/v1/observation/search", { query_vector: new Array(768).fill(0) }, env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("QUERY_DIM_MISMATCH");
  });
});

describe("§1 whitelist + subset stages", () => {
  it("whitelist domain filter → ladder_stage=whitelist, only matching captures", async () => {
    const { env, ids } = await seed();
    const res = await post("/api/v1/observation/search", { domain: "mineral" }, env);
    const body = (await res.json()) as { ladder_stage: string; results: { capture_id: string }[] };
    expect(body.ladder_stage).toBe("whitelist");
    expect(body.results.map((r) => r.capture_id)).toEqual([ids.c]);
  });

  it("subset measurement-range filter → ladder_stage=subset, deterministic", async () => {
    const { env, ids } = await seed();
    const res = await post("/api/v1/observation/search", { measurements: [{ item: "len", min: 40, max: 60 }] }, env);
    const body = (await res.json()) as { ladder_stage: string; results: { capture_id: string }[] };
    expect(body.ladder_stage).toBe("subset");
    expect(body.results.map((r) => r.capture_id)).toEqual([ids.b]);
  });

  it("whitelist + subset compose (biology AND len in range)", async () => {
    const { env, ids } = await seed();
    const res = await post("/api/v1/observation/search", { domain: "biology", measurements: [{ item: "len", min: 0, max: 20 }] }, env);
    const body = (await res.json()) as { ladder_stage: string; results: { capture_id: string }[] };
    expect(body.ladder_stage).toBe("subset");
    expect(body.results.map((r) => r.capture_id)).toEqual([ids.a]);
  });
});

describe("§1 auth + validation", () => {
  it("unauthenticated search → 401", async () => {
    const res = await post("/api/v1/observation/search", { domain: "biology" }, makeEnv(), JSON_HEADERS);
    expect(res.status).toBe(401);
  });

  it("query_capture_id with no embedding manifest → 400", async () => {
    const { env } = await seed();
    const res = await post("/api/v1/observation/search", { query_capture_id: ulid() }, env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("QUERY_EMBEDDING_NOT_FOUND");
  });
});
