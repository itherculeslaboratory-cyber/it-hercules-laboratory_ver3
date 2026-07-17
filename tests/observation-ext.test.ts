// C5 K1 observation-routes extension TC (design-k1 §3 tests/observation-ext).
// Drives the real app through the auth gate (DEV_TOKEN bearer). Covers
// OBS-06 (value_origin gate) / OBS-10-11 (rerank + aggregate) / OBS-18
// (dictionary + template scope) / OBS-20 (qr prefill) / OBS-23 (thumbnail,
// no bulk raw) / OBS-25-62 (commit gate) / OBS-48 (reanalyze append).
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { ulid, TruthStore } from "@ihl/truth";
import { compositeScore, aggregateIndividual } from "../apps/api/src/observation-routes";
import { RERANK_WEIGHTS, RERANK_MISSING, SCALE_PAPER, calibratedRealLengthMm } from "../apps/api/src/observation-constants";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const JSON_HEADERS = { "content-type": "application/json" };
const AUTH = { Authorization: `Bearer ${DEV_TOKEN}` };
const AUTH_JSON = { ...AUTH, ...JSON_HEADERS };

function ctx() {
  const bucket = new FakeR2Bucket();
  return { bucket, env: makeEnv(bucket) };
}
async function post(path: string, body: unknown, env: object, headers = AUTH_JSON) {
  return app.request(path, { method: "POST", headers, body: JSON.stringify(body) }, env);
}
async function get(path: string, env: object) {
  return app.request(path, { headers: AUTH }, env);
}

function vec384(components: Record<number, number>): Float32Array {
  const v = new Float32Array(384);
  for (const [i, x] of Object.entries(components)) v[Number(i)] = x;
  return v;
}
// Seed a capture (via API) + its own single-vector embeddings.bin + manifest.
async function seedCapture(
  bucket: FakeR2Bucket,
  env: object,
  spec: { id: string; domain?: string; subject_ref?: string; vec?: Float32Array; measurements?: unknown[] },
) {
  const res = await post(
    "/api/v1/observation/captures",
    { capture_id: spec.id, domain: spec.domain ?? "biology", subject_ref: spec.subject_ref, measurements: spec.measurements },
    env,
  );
  expect(res.status).toBe(202);
  if (spec.vec) {
    const file = `embeddings/bin/${spec.id}.bin`;
    await bucket.put(`embeddings/manifest/${spec.id}.json`, JSON.stringify({ capture_id: spec.id, embedding_dim: spec.vec.length, embedding_file: file, vector_offset: 0 }));
    await bucket.put(file, spec.vec);
  }
}

describe("OBS-06 appendMeasurement value_origin gate", () => {
  it("measurement missing value_origin → 400", async () => {
    const { env } = ctx();
    const res = await post(
      "/api/v1/observation/measurements",
      { domain: "biology", measurements: [{ item: "len", kind: "number", value: 5 }] },
      env,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("MEASUREMENT_VALUE_ORIGIN_REQUIRED");
  });

  it("measurement with an out-of-enum value_origin → 400", async () => {
    const { env } = ctx();
    const res = await post(
      "/api/v1/observation/measurements",
      { domain: "biology", measurements: [{ item: "len", kind: "number", value: 5, value_origin: "guessed" }] },
      env,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("INVALID_VALUE_ORIGIN");
  });

  it("imputed and estimated for the same item are BOTH kept (no collapse)", async () => {
    const { env } = ctx();
    const res = await post(
      "/api/v1/observation/measurements",
      {
        domain: "biology",
        measurements: [
          { item: "len", kind: "number", value: 5, value_origin: "imputed" },
          { item: "len", kind: "number", value: 6, value_origin: "estimated" },
        ],
      },
      env,
    );
    expect(res.status).toBe(202);
    const { capture_id } = (await res.json()) as { capture_id: string };
    const detail = (await (await get(`/api/v1/observation/${capture_id}`, env)).json()) as {
      capture: { measurements: { value_origin: string; value: number }[] };
    };
    const origins = detail.capture.measurements.map((m) => m.value_origin).sort();
    expect(origins).toEqual(["estimated", "imputed"]);
    expect(detail.capture.measurements.map((m) => m.value).sort()).toEqual([5, 6]);
  });
});

describe("OBS-11 compositeScore + aggregateIndividual (pure, deterministic)", () => {
  it("compositeScore blends 0.50/0.20/0.20/0.10 with 欠測既定", () => {
    // all present → weighted sum of 1s = sum of weights = 1.0
    expect(compositeScore({ embedding: 1, color: 1, size: 1, lineage: 1 })).toBeCloseTo(1, 10);
    // only embedding → color/size default 0.5, lineage default 0.0
    const expected = RERANK_WEIGHTS.embedding * 1 + RERANK_WEIGHTS.color * RERANK_MISSING.color + RERANK_WEIGHTS.size * RERANK_MISSING.size + RERANK_WEIGHTS.lineage * RERANK_MISSING.lineage;
    expect(compositeScore({ embedding: 1 })).toBeCloseTo(expected, 10);
    expect(compositeScore({ embedding: 1 })).toBeCloseTo(0.7, 10);
    // lineage present → +0.10
    expect(compositeScore({ embedding: 1, lineage: 1 })).toBeCloseTo(0.8, 10);
  });

  it("aggregateIndividual: max | mean_top3 | weighted_latest", () => {
    expect(aggregateIndividual([0.2, 0.9, 0.5], "max")).toBe(0.9);
    expect(aggregateIndividual([0.9, 0.8, 0.7, 0.1], "mean_top3")).toBeCloseTo((0.9 + 0.8 + 0.7) / 3, 10);
    // newest last, weight = 1-based position: (1*0.2 + 2*0.8) / 3
    expect(aggregateIndividual([0.2, 0.8], "weighted_latest")).toBeCloseTo((1 * 0.2 + 2 * 0.8) / 3, 10);
    expect(aggregateIndividual([], "max")).toBe(0);
  });
});

describe("OBS-10 search: self-exclusion + prototype averaging + rerank + aggregate", () => {
  it("query 自身除外: the query capture is not ranked against itself", async () => {
    const { bucket, env } = ctx();
    const a = ulid();
    const b = ulid();
    await seedCapture(bucket, env, { id: a, vec: vec384({ 0: 1 }) });
    await seedCapture(bucket, env, { id: b, vec: vec384({ 0: 1 }) });
    const res = await post("/api/v1/observation/search", { query_capture_id: a }, env);
    const body = (await res.json()) as { results: { capture_id: string }[] };
    const ids = body.results.map((r) => r.capture_id);
    expect(ids).toContain(b);
    expect(ids).not.toContain(a);
  });

  it("prototype 平均ベクトル: averages the prototype set and excludes them", async () => {
    const { bucket, env } = ctx();
    const a = ulid();
    const b = ulid();
    const c = ulid();
    await seedCapture(bucket, env, { id: a, vec: vec384({ 0: 1 }) });
    await seedCapture(bucket, env, { id: b, vec: vec384({ 1: 1 }) });
    // c points at the mean direction of a & b → cosine 1 with the averaged query.
    await seedCapture(bucket, env, { id: c, vec: vec384({ 0: Math.SQRT1_2, 1: Math.SQRT1_2 }) });
    const res = await post("/api/v1/observation/search", { prototype_capture_ids: [a, b] }, env);
    const body = (await res.json()) as { results: { capture_id: string; score: number }[] };
    const ids = body.results.map((r) => r.capture_id);
    expect(ids).toEqual([c]); // a,b excluded as prototypes
    expect(body.results[0].score).toBeCloseTo(1, 5);
  });

  it("rerank=true blends lineage: same-individual candidate outranks a stranger", async () => {
    const { bucket, env } = ctx();
    const q = ulid();
    const kin = ulid();
    const stranger = ulid();
    await seedCapture(bucket, env, { id: q, subject_ref: "individual/X", vec: vec384({ 0: 1 }) });
    await seedCapture(bucket, env, { id: kin, subject_ref: "individual/X", vec: vec384({ 0: 1 }) });
    await seedCapture(bucket, env, { id: stranger, subject_ref: "individual/Y", vec: vec384({ 0: 1 }) });
    const res = await post("/api/v1/observation/search", { query_capture_id: q, rerank: true }, env);
    const body = (await res.json()) as { results: { capture_id: string; score: number }[] };
    expect(body.results.map((r) => r.capture_id)).toEqual([kin, stranger]);
    expect(body.results[0].score).toBeCloseTo(compositeScore({ embedding: 1, lineage: 1 }), 6); // 0.8
    expect(body.results[1].score).toBeCloseTo(compositeScore({ embedding: 1 }), 6); // 0.7
  });

  it("aggregate=max collapses candidates to one score per individual", async () => {
    const { bucket, env } = ctx();
    const q = ulid();
    const x1 = ulid();
    const x2 = ulid();
    const y1 = ulid();
    await seedCapture(bucket, env, { id: q, vec: vec384({ 0: 1 }) });
    await seedCapture(bucket, env, { id: x1, subject_ref: "individual/X", vec: vec384({ 0: 1 }) });
    await seedCapture(bucket, env, { id: x2, subject_ref: "individual/X", vec: vec384({ 0: 0.6, 1: 0.8 }) });
    await seedCapture(bucket, env, { id: y1, subject_ref: "individual/Y", vec: vec384({ 1: 1 }) });
    const res = await post("/api/v1/observation/search", { query_vector: Array.from(vec384({ 0: 1 })), aggregate: "max" }, env);
    const body = (await res.json()) as { aggregate: string; individuals: { subject_ref: string; score: number }[] };
    expect(body.aggregate).toBe("max");
    const x = body.individuals.find((i) => i.subject_ref === "individual/X")!;
    const y = body.individuals.find((i) => i.subject_ref === "individual/Y")!;
    expect(x.score).toBeCloseTo(1, 5); // max(1, 0.6) = 1
    expect(y.score).toBeCloseTo(0, 5);
    expect(x.score).toBeGreaterThan(y.score);
  });
});

describe("OBS-45/53 calibratedRealLengthMm (pixel->mm via known marker size)", () => {
  it("realLength = pixelLength × mmPerPixel using the SCALE_PAPER marker as the known reference", () => {
    // marker measured as 100px in the photo, known real size = SCALE_PAPER.marker_mm(10mm)
    // -> 1px = 0.1mm. A 50px-long subject -> 5mm.
    expect(calibratedRealLengthMm(50, 100)).toBeCloseTo(5, 9);
    expect(calibratedRealLengthMm(200, 100)).toBeCloseTo(20, 9);
  });

  it("a custom markerRealMm (e.g. the QR block instead of the corner marker) is honored", () => {
    expect(calibratedRealLengthMm(30, 150, SCALE_PAPER.qr_mm)).toBeCloseTo(3, 9);
  });

  it("degenerate/failed marker detection (<=0 or non-finite) -> null, never a bogus scale", () => {
    expect(calibratedRealLengthMm(50, 0)).toBeNull();
    expect(calibratedRealLengthMm(50, -10)).toBeNull();
    expect(calibratedRealLengthMm(50, NaN)).toBeNull();
    expect(calibratedRealLengthMm(NaN, 100)).toBeNull();
  });
});

describe("OBS-18 measurement dictionary + extensions + template scope", () => {
  it("dictionary derives from template item_hashes; unregistered item is flagged then registerable", async () => {
    const { env } = ctx();
    // register H1 via a template
    await post("/api/v1/observation/templates", { title: "t", items: [{ label: "全長", kind: "number", item_hash: "H1" }] }, env);
    const dict1 = (await (await get("/api/v1/observation/measurement-dictionary", env)).json()) as { dictionary: { item_hash: string }[] };
    expect(dict1.dictionary.map((d) => d.item_hash)).toContain("H1");

    // a measurement with an unregistered hash H2 is flagged
    const m = await post(
      "/api/v1/observation/measurements",
      { domain: "biology", measurements: [{ item: "重量", kind: "number", value: 3, value_origin: "direct_observed", item_hash: "H2" }] },
      env,
    );
    expect(((await m.json()) as { unregistered_item_hashes: string[] }).unregistered_item_hashes).toEqual(["H2"]);

    // register H2 permanently (常に)
    const ext = await post("/api/v1/observation/dictionary-extensions", { label: "重量", kind: "number", item_hash: "H2", mode: "always" }, env);
    expect(ext.status).toBe(202);
    expect(((await ext.json()) as { registered: boolean }).registered).toBe(true);
    const dict2 = (await (await get("/api/v1/observation/measurement-dictionary", env)).json()) as { dictionary: { item_hash: string }[] };
    expect(dict2.dictionary.map((d) => d.item_hash)).toContain("H2");
  });

  it("mode=once (今回だけ) does NOT persist to the dictionary", async () => {
    const { env } = ctx();
    const ext = await post("/api/v1/observation/dictionary-extensions", { label: "湿度", kind: "number", item_hash: "H9", mode: "once" }, env);
    expect(((await ext.json()) as { registered: boolean }).registered).toBe(false);
    const dict = (await (await get("/api/v1/observation/measurement-dictionary", env)).json()) as { dictionary: { item_hash: string }[] };
    expect(dict.dictionary.map((d) => d.item_hash)).not.toContain("H9");
  });

  it("invalid dictionary-extension mode → 400", async () => {
    const { env } = ctx();
    const res = await post("/api/v1/observation/dictionary-extensions", { label: "x", kind: "number", mode: "maybe" }, env);
    expect(res.status).toBe(400);
  });

  it("template detail returns scope (雌雄別/令齢別/置き場所別)", async () => {
    const { env } = ctx();
    const created = await post(
      "/api/v1/observation/templates",
      { title: "scoped", items: [{ label: "l", kind: "number" }], scope: { sex: "female", instar: "third_late", placement: "shelf-A" } },
      env,
    );
    const { template_id } = (await created.json()) as { template_id: string };
    const res = await get(`/api/v1/observation/templates/${template_id}`, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { template: { scope: { sex: string; instar: string; placement: string } } };
    expect(body.template.scope).toEqual({ sex: "female", instar: "third_late", placement: "shelf-A" });
  });
});

describe("OBS-20 qr prefill (?prefill=1) + entry_mode", () => {
  it("resolve with ?prefill=1 returns entry_mode=qr + last-observation prefill", async () => {
    const { env } = ctx();
    const indId = "ind-prefill";
    // last observation for this individual
    await post(
      "/api/v1/observation/captures",
      { capture_id: ulid(), domain: "biology", subject_ref: `individual/${indId}`, template_id: "tpl-7", species_candidate: "Felis catus", species_confirmed_by: "user", measurements: [{ item: "len", kind: "number", value: 12 }] },
      env,
    );
    const { token } = (await (await post(`/api/v1/individuals/${indId}/qr`, {}, env)).json()) as { token: string };

    const res = await get(`/api/v1/qr/${token}?prefill=1`, env);
    const body = (await res.json()) as { individual_id: string; entry_mode: string; prefill: { template_id: string; species_candidate: string; measurements: unknown[] } };
    expect(body.individual_id).toBe(indId);
    expect(body.entry_mode).toBe("qr");
    expect(body.prefill.template_id).toBe("tpl-7");
    expect(body.prefill.species_candidate).toBe("Felis catus");
    expect(body.prefill.measurements).toHaveLength(1);
  });

  it("bare resolve keeps the original { individual_id } shape (contract preserved)", async () => {
    const { env } = ctx();
    const { token } = (await (await post("/api/v1/individuals/ind-x/qr", {}, env)).json()) as { token: string };
    const res = await get(`/api/v1/qr/${token}`, env);
    expect(await res.json()).toEqual({ individual_id: "ind-x" });
  });
});

// V3-OBS-20 棚/場所からQR発行: a placement/shelf QR (issued via
// POST /placements/:id/qr, CL-10 env_qr_token_v1 shape) resolves through the
// SAME GET /qr/:token scan endpoint as an individual QR — 棚→個体→種→前回
// テンプレの連鎖。
describe("OBS-20 placement/shelf QR (棚→個体 連鎖)", () => {
  it("issues a CL-10-shaped env_qr_token_v1 token for a placement", async () => {
    const { env } = ctx();
    const { placement_id } = (await (await post("/api/v1/placements", { label: "棚A" }, env)).json()) as {
      placement_id: string;
    };
    const res = await post(`/api/v1/placements/${placement_id}/qr`, {}, env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string; placement_id: string; expires_at: string };
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(body.placement_id).toBe(placement_id);
  });

  it("scanning a placement QR with an occupant resolves to that individual + prefill (?prefill=1)", async () => {
    const { env } = ctx();
    const indId = "ind-shelf";
    const { placement_id } = (await (await post("/api/v1/placements", { label: "棚B" }, env)).json()) as {
      placement_id: string;
    };
    // "move" (kind:"move") is the phase:"start"/"end"-tagged occupancy path
    // (moveOccupancy, source-routes.ts) — plain POST /occupancy writes a
    // phase-less legacy record that is never "open" (see the ended-occupancy
    // test below), so the QR-resolve occupant lookup needs this route.
    await post(
      "/api/v1/observation/batch-commit",
      { items: [{ kind: "move", subject_ref: `individual/${indId}`, to_placement_id: placement_id }] },
      env,
    );
    await post(
      "/api/v1/observation/captures",
      { capture_id: ulid(), domain: "biology", subject_ref: `individual/${indId}`, template_id: "tpl-shelf", measurements: [{ item: "len", kind: "number", value: 5 }] },
      env,
    );
    const { token } = (await (await post(`/api/v1/placements/${placement_id}/qr`, {}, env)).json()) as { token: string };

    const res = await get(`/api/v1/qr/${token}?prefill=1`, env);
    const body = (await res.json()) as {
      placement_id: string;
      individual_id: string;
      entry_mode: string;
      prefill: { template_id: string; measurements: unknown[] };
    };
    expect(body.placement_id).toBe(placement_id);
    expect(body.individual_id).toBe(indId);
    expect(body.entry_mode).toBe("qr_placement");
    expect(body.prefill.template_id).toBe("tpl-shelf");
  });

  it("scanning an empty placement (no occupant) resolves without a 404", async () => {
    const { env } = ctx();
    const { placement_id } = (await (await post("/api/v1/placements", { label: "空の棚" }, env)).json()) as {
      placement_id: string;
    };
    const { token } = (await (await post(`/api/v1/placements/${placement_id}/qr`, {}, env)).json()) as { token: string };

    const res = await get(`/api/v1/qr/${token}?prefill=1`, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { individual_id: unknown; entry_mode: string };
    expect(body.individual_id).toBeNull();
    expect(body.entry_mode).toBe("qr_placement_empty");
  });

  it("an ended occupancy (subject moved elsewhere) no longer resolves as the current occupant", async () => {
    const { env } = ctx();
    const indId = "ind-moved-out";
    const { placement_id: shelfC } = (await (await post("/api/v1/placements", { label: "棚C" }, env)).json()) as {
      placement_id: string;
    };
    const { placement_id: shelfC2 } = (await (await post("/api/v1/placements", { label: "棚C2" }, env)).json()) as {
      placement_id: string;
    };
    await post(
      "/api/v1/observation/batch-commit",
      { items: [{ kind: "move", subject_ref: `individual/${indId}`, to_placement_id: shelfC }] },
      env,
    );
    // move again → ends the shelfC occupancy (phase:"end"), starts one at shelfC2.
    await post(
      "/api/v1/observation/batch-commit",
      { items: [{ kind: "move", subject_ref: `individual/${indId}`, to_placement_id: shelfC2 }] },
      env,
    );
    const { token } = (await (await post(`/api/v1/placements/${shelfC}/qr`, {}, env)).json()) as { token: string };
    const res = await get(`/api/v1/qr/${token}?prefill=1`, env);
    const body = (await res.json()) as { individual_id: unknown };
    expect(body.individual_id).toBeNull();
  });

  it("a phase-less legacy /occupancy record is not treated as a current occupant", async () => {
    const { env } = ctx();
    const indId = "ind-legacy";
    const { placement_id } = (await (await post("/api/v1/placements", { label: "棚C-legacy" }, env)).json()) as {
      placement_id: string;
    };
    await post("/api/v1/occupancy", { placement_id, subject_ref: `individual/${indId}` }, env);
    const { token } = (await (await post(`/api/v1/placements/${placement_id}/qr`, {}, env)).json()) as { token: string };
    const res = await get(`/api/v1/qr/${token}?prefill=1`, env);
    const body = (await res.json()) as { individual_id: unknown };
    expect(body.individual_id).toBeNull();
  });

  it("expired placement token → 410", async () => {
    const { env } = ctx();
    const { placement_id } = (await (await post("/api/v1/placements", { label: "棚D" }, env)).json()) as {
      placement_id: string;
    };
    const past = new Date(Date.now() - 1000).toISOString();
    const { token } = (await (
      await post(`/api/v1/placements/${placement_id}/qr`, { expires_at: past }, env)
    ).json()) as { token: string };
    const res = await get(`/api/v1/qr/${token}`, env);
    expect(res.status).toBe(410);
  });

  it("unknown token (neither individual nor placement store) → 404", async () => {
    const { env } = ctx();
    const res = await get("/api/v1/qr/not-a-real-token-at-all", env);
    expect(res.status).toBe(404);
  });
});

describe("OBS-23 thumbnail serve, no raw bulk download", () => {
  it("serves the 512px JPEG thumbnail blob", async () => {
    const { bucket, env } = ctx();
    const photoId = ulid();
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    await bucket.put(`media/thumbnail/${photoId}`, jpeg);
    const res = await get(`/api/v1/observation/cap-1/thumbnail/${photoId}`, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(jpeg);
  });

  it("missing thumbnail → 404; no raw bulk-download endpoint exists", async () => {
    const { env } = ctx();
    expect((await get("/api/v1/observation/cap-1/thumbnail/none", env)).status).toBe(404);
    // there is no /images (plural) bulk route — only per-photo image/thumbnail.
    expect((await get("/api/v1/observation/cap-1/images", env)).status).toBe(404);
  });

  it("obs-detail.json's photo list binds the thumbnail endpoint, not raw /image/ (regression guard)", async () => {
    // The screen-def contract itself, not just the API: obs-detail previously
    // bound its photo-listing item_image to .../image/{photo_id} (the RAW
    // full-size blob) — every detail-view render would bulk-download raw
    // photos, exactly what OBS-23 forbids. Read the on-disk def directly so a
    // future edit reintroducing /image/ here fails loudly.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const defPath = path.join(process.cwd(), "..", "screen-defs", "obs-detail.json");
    const def = JSON.parse(fs.readFileSync(defPath, "utf8")) as { nodes: unknown };
    const json = JSON.stringify(def);
    expect(json).toContain("/thumbnail/{{photo_id}}");
    expect(json).not.toMatch(/\/image\/\{\{photo_id\}\}/);
  });
});

describe("OBS-25/62 commit is the confirmed save path with the subspecies gate", () => {
  it("commit without subspecies → 202 and the capture is stored", async () => {
    const { env } = ctx();
    const res = await post("/api/v1/solid-observation/commit", { domain: "biology" }, env);
    expect(res.status).toBe(202);
    const { capture_id } = (await res.json()) as { capture_id: string };
    expect((await get(`/api/v1/observation/${capture_id}`, env)).status).toBe(200);
  });

  it("subspecies candidate confirmed by AI (or unconfirmed) → 400 (AI 自動確定禁止)", async () => {
    const { env } = ctx();
    const ai = await post("/api/v1/solid-observation/commit", { domain: "biology", subspecies_candidate: "X ssp.", subspecies_confirmed_by: "ai" }, env);
    expect(ai.status).toBe(400);
    expect(((await ai.json()) as { error: string }).error).toBe("SUBSPECIES_NOT_CONFIRMED");
    const missing = await post("/api/v1/solid-observation/commit", { domain: "biology", subspecies_candidate: "X ssp." }, env);
    expect(missing.status).toBe(400);
  });

  it("subspecies candidate confirmed by user → 202", async () => {
    const { env } = ctx();
    const res = await post("/api/v1/solid-observation/commit", { domain: "biology", subspecies_candidate: "X ssp.", subspecies_confirmed_by: "user" }, env);
    expect(res.status).toBe(202);
  });
});

describe("OBS-48 reanalyze appends (never overwrites) + manifest", () => {
  it("two reanalyses yield two distinct analysis_ids, both preserved with delta+semver", async () => {
    const { env } = ctx();
    const capId = ulid();
    await post("/api/v1/observation/captures", { capture_id: capId, domain: "biology" }, env);

    const r1 = await post(`/api/v1/observation/${capId}/reanalyze`, { results: { len: 5 }, delta: { len: 0 }, correction_semver: "1.0.0" }, env);
    expect(r1.status).toBe(202);
    const a1 = ((await r1.json()) as { analysis_id: string }).analysis_id;
    const r2 = await post(`/api/v1/observation/${capId}/reanalyze`, { results: { len: 6 }, delta: { len: 1 }, correction_semver: "1.1.0", is_manual_edit: true }, env);
    expect(r2.status).toBe(202);
    const a2 = ((await r2.json()) as { analysis_id: string }).analysis_id;
    expect(a2).not.toBe(a1);

    const manifest = (await (await get(`/api/v1/observation/${capId}/reanalysis-manifest`, env)).json()) as {
      count: number;
      analyses: { analysis_id: string; correction_semver: string; is_manual_edit: boolean }[];
    };
    expect(manifest.count).toBe(2);
    const semvers = manifest.analyses.map((a) => a.correction_semver).sort();
    expect(semvers).toEqual(["1.0.0", "1.1.0"]);
    // the original capture is untouched (not deleted) by reanalysis.
    expect((await get(`/api/v1/observation/${capId}`, env)).status).toBe(200);
  });

  it("reanalyze with a bad semver → 400 (schema pattern)", async () => {
    const { env } = ctx();
    const capId = ulid();
    await post("/api/v1/observation/captures", { capture_id: capId, domain: "biology" }, env);
    const res = await post(`/api/v1/observation/${capId}/reanalyze`, { results: { len: 5 }, correction_semver: "v1" }, env);
    expect(res.status).toBe(400);
  });
});

describe("OBS-07 remeasure タグの自動付与 (reanalyze毎に必ず付与)", () => {
  it("a successful reanalyze auto-appends a machine-layer 'remeasure' tag_event for the capture", async () => {
    const { bucket, env } = ctx();
    const capId = ulid();
    await post("/api/v1/observation/captures", { capture_id: capId, domain: "biology" }, env);
    const res = await post(`/api/v1/observation/${capId}/reanalyze`, { results: { len: 5 }, correction_semver: "1.0.0" }, env);
    expect(res.status).toBe(202);

    const events = (await new TruthStore(bucket).listEvents(`truth/ihl.obs.tag_event.v1/capture-${capId}-`)).map(
      (e) => e.data as { tag: string; tag_type: string; target_type: string; target_id: string; source_type: string },
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ tag: "remeasure", tag_type: "quality", target_type: "capture", target_id: capId, source_type: "machine_suggested" });
  });

  it("two reanalyses of the same capture each append their own remeasure tag (append-only, no collapse)", async () => {
    const { bucket, env } = ctx();
    const capId = ulid();
    await post("/api/v1/observation/captures", { capture_id: capId, domain: "biology" }, env);
    await post(`/api/v1/observation/${capId}/reanalyze`, { results: { len: 5 }, correction_semver: "1.0.0" }, env);
    await post(`/api/v1/observation/${capId}/reanalyze`, { results: { len: 6 }, correction_semver: "1.1.0" }, env);
    const events = await new TruthStore(bucket).listEvents(`truth/ihl.obs.tag_event.v1/capture-${capId}-`);
    expect(events).toHaveLength(2);
  });
});

// V3-OBS-72 研究室環境コンテキスト: GET /individuals/{id}/lab-environment は
// occupancy → placement → lab-environment を連鎖する(観測詳細 obs-detail が
// 表示する経路そのもの)。
describe("OBS-72 individual → placement → lab-environment 連鎖", () => {
  it("an individual with no open occupancy → placement_id/lab_environment both null", async () => {
    const { env } = ctx();
    const res = await get("/api/v1/individuals/ind-no-shelf/lab-environment", env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ individual_id: "ind-no-shelf", placement_id: null, lab_environment: null });
  });

  it("chains through the individual's current placement to its recorded environment", async () => {
    const { env } = ctx();
    const indId = "ind-lab-ctx";
    const { placement_id } = (await (await post("/api/v1/placements", { label: "棚Z" }, env)).json()) as {
      placement_id: string;
    };
    await post(
      "/api/v1/observation/batch-commit",
      { items: [{ kind: "move", subject_ref: `individual/${indId}`, to_placement_id: placement_id }] },
      env,
    );
    await post(`/api/v1/placements/${placement_id}/lab-environment`, { room_label: "飼育室2・北側", hvac_profile: "24℃設定" }, env);

    const res = await get(`/api/v1/individuals/${indId}/lab-environment`, env);
    const body = (await res.json()) as {
      individual_id: string;
      placement_id: string;
      lab_environment: { room_label: string; hvac_profile: string };
    };
    expect(body.placement_id).toBe(placement_id);
    expect(body.lab_environment.room_label).toBe("飼育室2・北側");
    expect(body.lab_environment.hvac_profile).toBe("24℃設定");
  });
});
