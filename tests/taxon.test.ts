// C5 K1 種/形態 TC (design-k1 §3 / V3-IND-19). put-if-absent 409 · fork 系譜 ·
// aliasCandidates(Levenshtein/Jaro-Winkler 決定論) · approveAlias は人間承認後のみ ·
// projectSpeciesStats 自動計算. Drives the real app (DEV_TOKEN) + unit-tests the
// exported pure functions.
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { deriveActorId } from "@ihl/truth";
import { aliasCandidates } from "../apps/api/src/taxon-routes";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const JSON_HEADERS = { "content-type": "application/json" };
const AUTH = { Authorization: `Bearer ${DEV_TOKEN}` };
const AUTH_JSON = { ...AUTH, ...JSON_HEADERS };
const DEV_ACTOR = await deriveActorId("dev@ihl.local");

function ctx() {
  return { env: makeEnv(new FakeR2Bucket()) };
}
async function post(path: string, body: unknown, env: object, headers = AUTH_JSON) {
  return app.request(path, { method: "POST", headers, body: JSON.stringify(body) }, env);
}
async function get(path: string, env: object) {
  return app.request(path, { headers: AUTH }, env);
}

describe("IND-19 種/形態 put-if-absent 409 + fork", () => {
  it("同一 species_id の二重作成 → 409", async () => {
    const { env } = ctx();
    expect((await post("/api/v1/species", { species_id: "sp1", name: "A" }, env)).status).toBe(201);
    expect((await post("/api/v1/species", { species_id: "sp1", name: "A" }, env)).status).toBe(409);
  });

  it("同一 morph_id の二重作成 → 409", async () => {
    const { env } = ctx();
    await post("/api/v1/species", { species_id: "sp1", name: "A" }, env);
    expect((await post("/api/v1/morphs", { morph_id: "m1", species_id: "sp1", name: "M" }, env)).status).toBe(201);
    expect((await post("/api/v1/morphs", { morph_id: "m1", species_id: "sp1", name: "M" }, env)).status).toBe(409);
  });

  it("fork(forked_from)で系譜を継承", async () => {
    const { env } = ctx();
    await post("/api/v1/species", { species_id: "sp1", name: "A" }, env);
    expect((await post("/api/v1/species", { species_id: "sp2", name: "B", forked_from: "sp1" }, env)).status).toBe(201);
    const body = (await (await get("/api/v1/species/sp2", env)).json()) as { species: { forked_from?: string } };
    expect(body.species.forked_from).toBe("sp1");
  });

  it("actor_id はセッション principal 強制(body の偽装を無視)", async () => {
    const { env } = ctx();
    await post("/api/v1/species", { species_id: "sp1", name: "A", actor_id: "attacker" }, env);
    const body = (await (await get("/api/v1/species/sp1", env)).json()) as { species: { actor_id: string } };
    expect(body.species.actor_id).toBe(DEV_ACTOR);
  });
});

describe("IND-19 aliasCandidates(決定論類似度)", () => {
  const existing = [
    { species_id: "sp1", name: "Heteropteryx dilatata" },
    { species_id: "sp2", name: "Extatosoma tiaratum" },
  ];

  it("完全一致が最上位・score=1", () => {
    const out = aliasCandidates("Heteropteryx dilatata", existing);
    expect(out[0].species_id).toBe("sp1");
    expect(out[0].score).toBeCloseTo(1, 10);
    expect(out[0].score).toBeGreaterThan(out[1].score);
  });

  it("表記ゆれ(typo)でも正しい種を最上位に", () => {
    const out = aliasCandidates("Heteropteryx dilatta", existing); // 1 char dropped
    expect(out[0].species_id).toBe("sp1");
    expect(out[0].score).toBeLessThan(1);
    expect(out[0].score).toBeGreaterThan(0.8);
  });

  it("決定論: 同入力は同出力", () => {
    expect(aliasCandidates("Heteropteryx dilatta", existing)).toEqual(
      aliasCandidates("Heteropteryx dilatta", existing),
    );
  });

  it("route GET /species/alias-candidates?name= が候補を返す", async () => {
    const { env } = ctx();
    await post("/api/v1/species", { species_id: "sp1", name: "Heteropteryx dilatata" }, env);
    await post("/api/v1/species", { species_id: "sp2", name: "Extatosoma tiaratum" }, env);
    const body = (await (await get("/api/v1/species/alias-candidates?name=Heteropteryx%20dilatta", env)).json()) as {
      candidates: { species_id: string }[];
    };
    expect(body.candidates[0].species_id).toBe("sp1");
  });
});

describe("IND-19 approveAlias(人間承認後のみ統合)", () => {
  it("approved_by 付きは統合(201)", async () => {
    const { env } = ctx();
    await post("/api/v1/species", { species_id: "sp1", name: "A" }, env);
    const res = await post(
      "/api/v1/species/aliases",
      { canonical_species_id: "sp1", alias_text: "foo", approved_by: DEV_ACTOR },
      env,
    );
    expect(res.status).toBe(201);
  });

  it("approved_by 欠落は 400(承認証跡なしでは統合しない)", async () => {
    const { env } = ctx();
    await post("/api/v1/species", { species_id: "sp1", name: "A" }, env);
    const res = await post("/api/v1/species/aliases", { canonical_species_id: "sp1", alias_text: "foo" }, env);
    expect(res.status).toBe(400);
  });
});

describe("IND-19 projectSpeciesStats(自動計算)", () => {
  it("該当 capture の avg size/weight を集計", async () => {
    const { env } = ctx();
    await post("/api/v1/species", { species_id: "sp1", name: "A" }, env);
    for (const [len, wt] of [[10, 5], [20, 15]] as const) {
      await post(
        "/api/v1/observation/captures",
        {
          domain: "biology",
          species_candidate: "sp1",
          measurements: [
            { item: "length", kind: "number", value: len },
            { item: "weight", kind: "number", value: wt },
          ],
        },
        env,
      );
    }
    const body = (await (await get("/api/v1/species/sp1", env)).json()) as {
      stats: { sample_count: number; avg_size: number; avg_weight: number; avg_market_price: number | null };
    };
    expect(body.stats.sample_count).toBe(2);
    expect(body.stats.avg_size).toBe(15);
    expect(body.stats.avg_weight).toBe(10);
    expect(body.stats.avg_market_price).toBeNull();
  });
});
