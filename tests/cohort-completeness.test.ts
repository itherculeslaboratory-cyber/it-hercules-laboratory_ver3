// C7 背骨S7 TC: コホート完結性(V3-KRM-35・GET /clutches/:id/completeness)。
// Drives the real app through the auth gate, same convention as tests/clutch.test.ts.
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const AUTH = { Authorization: `Bearer ${DEV_TOKEN}` };
const AUTH_JSON = { ...AUTH, "content-type": "application/json" };
const DEATH_DETAIL = { at_stage: "third_instar", terminal_observation: { weight_g: 0.4 } };

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
async function createClutch(env: object, body: Record<string, unknown> = {}): Promise<string> {
  const res = await post("/api/v1/clutches", { harvested_at: "2026-07-12", initial_count: 10, ...body }, env);
  expect(res.status).toBe(201);
  return ((await res.json()) as { clutch_id: string }).clutch_id;
}
async function promote(env: object, clutchId: string, count: number, deathCount = 0): Promise<string[]> {
  const res = await post(`/api/v1/clutches/${clutchId}/promote`, { count, death_count: deathCount, at: "2026-08-01T00:00:00Z" }, env);
  expect(res.status).toBe(201);
  return ((await res.json()) as { individual_ids: string[] }).individual_ids;
}
async function completeness(env: object, clutchId: string) {
  const res = await get(`/api/v1/clutches/${clutchId}/completeness`, env);
  expect(res.status).toBe(200);
  return (await res.json()) as {
    denominator: number;
    explained_individual_terminal: number;
    explained_attrition_death: number;
    explained_promote_death: number;
    explained_count_layer_lost: number;
    explained_total: number;
    surviving: number;
    unexplained: number;
    completeness_ratio: number;
    complete: boolean;
  };
}

describe("GET /clutches/:id/completeness — コホート完結性 (V3-KRM-35)", () => {
  it("全頭が個体終端(eclosion/death/lost)まで説明済みなら ratio=1.0・complete=true", async () => {
    const { env } = ctx();
    const id = await createClutch(env, { initial_count: 3 });
    const ids = await promote(env, id, 3);
    await post(`/api/v1/individuals/${ids[0]}/life-events`, { kind: "eclosion", at: "2026-08-05T00:00:00Z" }, env);
    await post(`/api/v1/individuals/${ids[1]}/life-events`, { kind: "death", at: "2026-08-05T00:00:00Z", detail: DEATH_DETAIL }, env);
    await post(`/api/v1/individuals/${ids[2]}/life-events`, { kind: "lost", at: "2026-08-05T00:00:00Z" }, env);

    const view = await completeness(env, id);
    expect(view.denominator).toBe(3);
    expect(view.explained_individual_terminal).toBe(3);
    expect(view.surviving).toBe(0);
    expect(view.unexplained).toBe(0);
    expect(view.completeness_ratio).toBe(1);
    expect(view.complete).toBe(true);
  });

  it("未記録の減耗(promote数が分母を下回り、promoteされた個体もまだ終端無し)は ratio<1・complete=false", async () => {
    const { env } = ctx();
    const id = await createClutch(env, { initial_count: 10 });
    // 10匹のはずが7匹しかpromoteされない(3匹は記録なしに消えた=未記録減耗)。
    const ids = await promote(env, id, 7);
    // うち2匹だけ終端(eclosion)、残り5匹はまだ幼虫のまま(未終端=生存中)。
    await post(`/api/v1/individuals/${ids[0]}/life-events`, { kind: "eclosion", at: "2026-08-05T00:00:00Z" }, env);
    await post(`/api/v1/individuals/${ids[1]}/life-events`, { kind: "eclosion", at: "2026-08-05T00:00:00Z" }, env);

    const view = await completeness(env, id);
    expect(view.denominator).toBe(10);
    expect(view.explained_individual_terminal).toBe(2);
    expect(view.surviving).toBe(5); // 7 promoted - 2 explained
    expect(view.unexplained).toBe(3); // 10 - 2 - 5 (record-less shortfall never promoted)
    expect(view.completeness_ratio).toBeLessThan(1);
    expect(view.completeness_ratio).toBe(0.2); // 2 / 10
    expect(view.complete).toBe(false);
  });

  it("count層(attrition death_count)と individual層(promote済み終端)の二層が合算される", async () => {
    const { env } = ctx();
    const id = await createClutch(env, { initial_count: 10 });
    // count層のまま3匹は記録済みの減耗(attrition)。
    await post(`/api/v1/clutches/${id}/events`, { kind: "attrition", death_count: 3, at: "2026-07-20T00:00:00Z" }, env);
    // 残り7匹をpromote。うち4匹はindividual層で終端(death)、3匹はまだ未終端。
    const ids = await promote(env, id, 7);
    for (const i of [0, 1, 2, 3]) {
      await post(`/api/v1/individuals/${ids[i]}/life-events`, { kind: "death", at: "2026-08-05T00:00:00Z", detail: DEATH_DETAIL }, env);
    }

    const view = await completeness(env, id);
    expect(view.denominator).toBe(10);
    expect(view.explained_individual_terminal).toBe(4); // individual層
    expect(view.explained_attrition_death).toBe(3); // count層
    expect(view.explained_total).toBe(7); // 4 + 3 の合算
    expect(view.surviving).toBe(3); // 7 promoted - 4 explained
    expect(view.unexplained).toBe(0); // 10 - 7 - 3
    expect(view.completeness_ratio).toBe(0.7);
    expect(view.complete).toBe(false); // surviving 3 が残っている
  });

  it("分母0(recount無し・initial_count 0)でもゼロ除算にならず ratio=1・complete=true", async () => {
    const { env } = ctx();
    const id = await createClutch(env, { initial_count: 0 });
    const view = await completeness(env, id);
    expect(view.denominator).toBe(0);
    expect(view.explained_total).toBe(0);
    expect(view.surviving).toBe(0);
    expect(view.unexplained).toBe(0);
    expect(Number.isFinite(view.completeness_ratio)).toBe(true);
    expect(view.completeness_ratio).toBe(1);
    expect(view.complete).toBe(true);
  });

  it("未知のclutch_id -> 404", async () => {
    const { env } = ctx();
    expect((await get("/api/v1/clutches/nope/completeness", env)).status).toBe(404);
  });
});
