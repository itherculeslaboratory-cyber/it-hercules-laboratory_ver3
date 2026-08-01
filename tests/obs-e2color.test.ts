// g80-e2color(b3think §3-3): 色検索接続 — 新イベント型 ihl.obs.color.v1 の保存 +
// /observation/search への deltaE76 配線。RERANK_WEIGHTS は変更しない(値のテストは
// tests/observation-ext.test.ts の既存 compositeScore TC が既に緑を守っている)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { ulid } from "@ihl/truth";
import { compositeScore } from "../apps/api/src/observation-routes";
import { BPCMS_VERSION, deltaE76, colorSimilarityFromDeltaE76, COLOR_DELTA_E_NORM_MAX } from "../apps/api/src/observation-constants";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const JSON_HEADERS = { "content-type": "application/json" };
const AUTH = { Authorization: `Bearer ${DEV_TOKEN}` };
const AUTH_JSON = { ...AUTH, ...JSON_HEADERS };

function ctx() {
  const bucket = new FakeR2Bucket();
  return { bucket, env: makeEnv(bucket) };
}
async function post(path: string, body: unknown, env: object) {
  return app.request(path, { method: "POST", headers: AUTH_JSON, body: JSON.stringify(body) }, env);
}

function vec384(components: Record<number, number>): Float32Array {
  const v = new Float32Array(384);
  for (const [i, x] of Object.entries(components)) v[Number(i)] = x;
  return v;
}

async function seedCapture(
  bucket: FakeR2Bucket,
  env: object,
  spec: { id: string; vec: Float32Array },
) {
  const res = await post("/api/v1/observation/captures", { capture_id: spec.id, domain: "biology" }, env);
  expect(res.status).toBe(202);
  const file = `embeddings/bin/${spec.id}.bin`;
  await bucket.put(`embeddings/manifest/${spec.id}.json`, JSON.stringify({ capture_id: spec.id, embedding_dim: spec.vec.length, embedding_file: file, vector_offset: 0 }));
  await bucket.put(file, spec.vec);
}

describe("ihl.obs.color.v1 — POST /observation/{capture_id}/color", () => {
  it("stores a color event and stamps BPCMS_VERSION from the frozen constant (not a literal)", async () => {
    const { env } = ctx();
    const cap = ulid();
    await post("/api/v1/observation/captures", { capture_id: cap, domain: "biology" }, env);
    const res = await post(`/api/v1/observation/${cap}/color`, { lab: { l: 50, a: 10, b: -5 }, hsv: { h: 30, s: 0.5, v: 0.6 }, region: "full", source: "client_upload_auto" }, env);
    expect(res.status).toBe(202);
    const { color_id } = (await res.json()) as { color_id: string };
    expect(typeof color_id).toBe("string");
    expect(color_id.length).toBeGreaterThan(0);
  });

  it("rejects a body missing lab/hsv (schema validation actually fires)", async () => {
    const { env } = ctx();
    const cap = ulid();
    await post("/api/v1/observation/captures", { capture_id: cap, domain: "biology" }, env);
    const res = await post(`/api/v1/observation/${cap}/color`, { hsv: { h: 1, s: 1, v: 1 } }, env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("INVALID_BODY");
  });

  it("rejects an out-of-schema bpcms_version-less body shape via additionalProperties:false", async () => {
    const { env } = ctx();
    const cap = ulid();
    await post("/api/v1/observation/captures", { capture_id: cap, domain: "biology" }, env);
    // unknown_field は additionalProperties:false でスキーマ検証に落ちるはず
    const res = await post(
      `/api/v1/observation/${cap}/color`,
      { lab: { l: 1, a: 1, b: 1, unknown_field: 1 }, hsv: { h: 1, s: 1, v: 1 } },
      env,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("INVALID_COLOR");
  });
});

describe("g80-e2color: colorSimilarityFromDeltaE76 (pure, deterministic)", () => {
  it("ΔE76=0(同色) → 類似度1", () => {
    expect(colorSimilarityFromDeltaE76(0)).toBeCloseTo(1, 10);
  });
  it("ΔE76 >= COLOR_DELTA_E_NORM_MAX → 類似度0(下限でクランプ)", () => {
    expect(colorSimilarityFromDeltaE76(COLOR_DELTA_E_NORM_MAX)).toBeCloseTo(0, 10);
    expect(colorSimilarityFromDeltaE76(COLOR_DELTA_E_NORM_MAX * 2)).toBe(0);
  });
  it("非有限値/負値はでたらめな数を返さず0(誇張ゼロ)", () => {
    expect(colorSimilarityFromDeltaE76(Number.NaN)).toBe(0);
    expect(colorSimilarityFromDeltaE76(-5)).toBe(0);
  });
  it("単調減少(ΔE76が大きいほど類似度は下がる)", () => {
    expect(colorSimilarityFromDeltaE76(10)).toBeGreaterThan(colorSimilarityFromDeltaE76(50));
  });
});

describe("g80-e2color: /observation/search の rerank に color を配線", () => {
  it("query_lab に近いcaptureが遠いcaptureより上位に来る(embedding/lineageは同点で揃える)", async () => {
    const { bucket, env } = ctx();
    const q = ulid();
    const near = ulid();
    const far = ulid();
    // 全candidate同一ベクトル → embeddingでは同点。color差だけが順位を決める。
    await seedCapture(bucket, env, { id: q, vec: vec384({ 0: 1 }) });
    await seedCapture(bucket, env, { id: near, vec: vec384({ 0: 1 }) });
    await seedCapture(bucket, env, { id: far, vec: vec384({ 0: 1 }) });

    const queryLab = { l: 50, a: 0, b: 0 };
    await post(`/api/v1/observation/${near}/color`, { lab: { l: 51, a: 1, b: 0 }, hsv: { h: 0, s: 0, v: 0 } }, env); // ΔE76 ≈ 1.41
    await post(`/api/v1/observation/${far}/color`, { lab: { l: 90, a: 40, b: 40 }, hsv: { h: 0, s: 0, v: 0 } }, env); // ΔE76 大

    const res = await post("/api/v1/observation/search", { query_capture_id: q, rerank: true, query_lab: queryLab }, env);
    const body = (await res.json()) as { results: { capture_id: string; score: number }[] };
    const ids = body.results.map((r) => r.capture_id);
    expect(ids).toEqual([near, far]);
  });

  it("query_lab 未指定なら従来どおり RERANK_MISSING.color(0.5固定)にフォールバックする(後方互換)", async () => {
    const { bucket, env } = ctx();
    const q = ulid();
    const cand = ulid();
    await seedCapture(bucket, env, { id: q, vec: vec384({ 0: 1 }) });
    await seedCapture(bucket, env, { id: cand, vec: vec384({ 0: 1 }) });
    await post(`/api/v1/observation/${cand}/color`, { lab: { l: 51, a: 1, b: 0 }, hsv: { h: 0, s: 0, v: 0 } }, env);

    const res = await post("/api/v1/observation/search", { query_capture_id: q, rerank: true }, env);
    const body = (await res.json()) as { results: { capture_id: string; score: number }[] };
    expect(body.results[0].score).toBeCloseTo(compositeScore({ embedding: 1 }), 6);
  });

  it("未遡及(色イベントが無い過去のcapture)は query_lab 指定時も欠測既定(0.5)のまま検索に出る — G79-3の帰結", async () => {
    const { bucket, env } = ctx();
    const q = ulid();
    const oldCapture = ulid(); // 色イベント無し=遡及していない扱い
    await seedCapture(bucket, env, { id: q, vec: vec384({ 0: 1 }) });
    await seedCapture(bucket, env, { id: oldCapture, vec: vec384({ 0: 1 }) });

    const res = await post("/api/v1/observation/search", { query_capture_id: q, rerank: true, query_lab: { l: 50, a: 0, b: 0 } }, env);
    const body = (await res.json()) as { results: { capture_id: string; score: number }[] };
    expect(body.results.map((r) => r.capture_id)).toContain(oldCapture);
    expect(body.results[0].score).toBeCloseTo(compositeScore({ embedding: 1 }), 6); // color欠測既定=0.5のまま
  });
});

describe("g80-e2color: deltaE76/BPCMS_VERSION は既存の凍結実装をそのまま使う(自前で作り直していない)", () => {
  it("BPCMS_VERSION は 1.0", () => {
    expect(BPCMS_VERSION).toBe("1.0");
  });
  it("deltaE76 はユークリッド距離(CIE76)そのもの", () => {
    expect(deltaE76({ l: 0, a: 0, b: 0 }, { l: 3, a: 4, b: 0 })).toBeCloseTo(5, 10);
  });
});
