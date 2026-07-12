// C7 スライス2 TC: クラッチ(匿名プール・count層)+一括保存+occupancy 移動+個体
// 一覧拡張 (V3-AIP-101 wireframes-core5 §F3/F4). Drives the real app through the
// auth gate (DEV_TOKEN bearer), same convention as tests/individual.test.ts.
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { deriveActorId } from "@ihl/truth";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const AUTH = { Authorization: `Bearer ${DEV_TOKEN}` };
const AUTH_JSON = { ...AUTH, "content-type": "application/json" };
const DEV_ACTOR = await deriveActorId("dev@ihl.local");

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
async function createClutch(env: object, body: Record<string, unknown> = {}): Promise<string> {
  const res = await post(
    "/api/v1/clutches",
    { harvested_at: "2026-07-12", initial_count: 94, ...body },
    env,
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { clutch_id: string }).clutch_id;
}

describe("clutch create + current_count projection", () => {
  it("creates a clutch; current_count starts at initial_count", async () => {
    const { env } = ctx();
    const id = await createClutch(env);
    const detail = (await (await get(`/api/v1/clutches/${id}`, env)).json()) as {
      current_count: number;
      actor_id: string;
    };
    expect(detail.current_count).toBe(94);
    expect(detail.actor_id).toBe(DEV_ACTOR); // forced from session, not body
  });

  it("subspecies candidate without user confirmation -> 400 (自動確定禁止)", async () => {
    const { env } = ctx();
    const res = await post(
      "/api/v1/clutches",
      { harvested_at: "2026-07-12", initial_count: 10, subspecies_candidate: "hercules" },
      env,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({ error: "SUBSPECIES_NOT_CONFIRMED" });
  });

  it("negative/non-integer initial_count -> 400", async () => {
    const { env } = ctx();
    expect((await post("/api/v1/clutches", { harvested_at: "2026-07-12", initial_count: -1 }, env)).status).toBe(400);
    expect((await post("/api/v1/clutches", { harvested_at: "2026-07-12", initial_count: 1.5 }, env)).status).toBe(400);
  });

  it("list is 本人スコープ", async () => {
    const { env } = ctx();
    await createClutch(env);
    await createClutch(env);
    const list = (await (await get("/api/v1/clutches", env)).json()) as { clutches: unknown[] };
    expect(list.clutches).toHaveLength(2);
  });

  it("recount resets the basis; subsequent attrition subtracts from the NEW basis only", async () => {
    const { env } = ctx();
    const id = await createClutch(env, { initial_count: 100 });

    // recount to 90 (basis reset — an attrition BEFORE this would be absorbed)
    const rc = await post(`/api/v1/clutches/${id}/events`, { kind: "recount", counted: 90, at: "2026-07-13T00:00:00Z" }, env);
    expect(rc.status).toBe(201);
    let detail = (await (await get(`/api/v1/clutches/${id}`, env)).json()) as { current_count: number };
    expect(detail.current_count).toBe(90);

    // attrition of 5 AFTER the recount -> 85
    const at = await post(`/api/v1/clutches/${id}/events`, { kind: "attrition", death_count: 5, at: "2026-07-14T00:00:00Z" }, env);
    expect(at.status).toBe(201);
    detail = (await (await get(`/api/v1/clutches/${id}`, env)).json()) as { current_count: number };
    expect(detail.current_count).toBe(85);
  });

  it("attrition exceeding current_count -> 400", async () => {
    const { env } = ctx();
    const id = await createClutch(env, { initial_count: 10 });
    const res = await post(`/api/v1/clutches/${id}/events`, { kind: "attrition", death_count: 11, at: "2026-07-14T00:00:00Z" }, env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("ATTRITION_EXCEEDS_COUNT");
  });

  it("events for an unknown clutch -> 404; promote/attrition on an invalid kind -> 400", async () => {
    const { env } = ctx();
    const missing = await post("/api/v1/clutches/nope/events", { kind: "recount", counted: 1, at: "2026-07-14T00:00:00Z" }, env);
    expect(missing.status).toBe(404);
    const id = await createClutch(env, { initial_count: 10 });
    const badKind = await post(`/api/v1/clutches/${id}/events`, { kind: "promote", at: "2026-07-14T00:00:00Z" }, env);
    expect(badKind.status).toBe(400);
  });
});

describe("clutch promote (個別容器へ分割 / 昇格)", () => {
  it("creates `count` individuals inheriting species/sire/dam/harvested_at, appends promote event, current_count drops by count+death_count", async () => {
    const { env } = ctx();
    const sireRes = await post("/api/v1/individuals", { species: "Dynastes hercules" }, env);
    const sireId = ((await sireRes.json()) as { individual_id: string }).individual_id;
    const damRes = await post("/api/v1/individuals", {}, env);
    const damId = ((await damRes.json()) as { individual_id: string }).individual_id;

    const id = await createClutch(env, { initial_count: 68, species: "Dynastes hercules", sire_id: sireId, dam_id: damId });

    const promote = await post(`/api/v1/clutches/${id}/promote`, { count: 60, death_count: 8, at: "2026-08-01T00:00:00Z" }, env);
    expect(promote.status).toBe(201);
    const body = (await promote.json()) as { individual_ids: string[]; current_count: number };
    expect(body.individual_ids).toHaveLength(60);
    expect(body.current_count).toBe(0); // 68 - 60 - 8

    const firstInd = (await (await get(`/api/v1/individuals/${body.individual_ids[0]}`, env)).json()) as {
      master: { species: string; birth_or_hatch_date: string };
    };
    expect(firstInd.master.species).toBe("Dynastes hercules");
    expect(firstInd.master.birth_or_hatch_date).toBe("2026-07-12"); // == clutch.harvested_at

    const pedigree = (await (await get(`/api/v1/individuals/${body.individual_ids[0]}/pedigree`, env)).json()) as {
      parents: { individual_id: string; parent_role: string }[];
    };
    const roles = pedigree.parents.map((p) => p.parent_role).sort();
    expect(roles).toEqual(["dam", "sire"]);
  });

  it("count + death_count exceeding current_count -> 400, no individuals created", async () => {
    const { env } = ctx();
    const id = await createClutch(env, { initial_count: 10 });
    const res = await post(`/api/v1/clutches/${id}/promote`, { count: 8, death_count: 5, at: "2026-08-01T00:00:00Z" }, env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; current_count: number };
    expect(body.error).toBe("PROMOTE_EXCEEDS_COUNT");
    expect(body.current_count).toBe(10);
  });
});

describe("clutch 抜き取り計測 — 既存 capture を subject_ref=clutch/<id> で再利用(専用APIなし)", () => {
  it("captures totals/avg weight against a clutch via the existing observation/captures route", async () => {
    const { env } = ctx();
    const id = await createClutch(env, { initial_count: 94 });
    const res = await post(
      "/api/v1/observation/captures",
      {
        domain: "biology",
        subject_ref: `clutch/${id}`,
        measurements: [
          { item: "weight_total", kind: "number", value: 21.0, unit: "g", value_origin: "direct_observed" },
          { item: "weight_avg", kind: "number", value: 2.1, unit: "g", value_origin: "direct_observed" },
          { item: "sample_count", kind: "number", value: 10, value_origin: "direct_observed" },
        ],
      },
      env,
    );
    expect(res.status).toBe(202);
    const captureId = ((await res.json()) as { capture_id: string }).capture_id;
    const detail = (await (await get(`/api/v1/observation/${captureId}`, env)).json()) as {
      capture: { subject_ref: string };
    };
    expect(detail.capture.subject_ref).toBe(`clutch/${id}`);
  });
});

describe("observation/batch-commit — F4/F5 一括保存", () => {
  it("commits capture + life-event + clutch-event + move items sequentially, per-item results, no rollback on partial failure", async () => {
    const { env } = ctx();
    const indRes = await post("/api/v1/individuals", { species: "Dynastes hercules" }, env);
    const individualId = ((await indRes.json()) as { individual_id: string }).individual_id;
    const clutchId = await createClutch(env, { initial_count: 20 });
    const placeA = ((await (await post("/api/v1/placements", { label: "Shelf A" }, env)).json()) as { placement_id: string }).placement_id;
    const placeB = ((await (await post("/api/v1/placements", { label: "Shelf B" }, env)).json()) as { placement_id: string }).placement_id;

    const res = await post(
      "/api/v1/observation/batch-commit",
      {
        items: [
          { kind: "capture", body: { domain: "biology", subject_ref: `individual/${individualId}`, measurements: [{ item: "weight", kind: "number", value: 85.8, unit: "g" }] } },
          { kind: "life-event", individual_id: individualId, body: { kind: "molt", at: "2026-07-12T00:00:00Z", detail: { to_stage: "third_late" } } },
          { kind: "clutch-event", clutch_id: clutchId, body: { kind: "recount", counted: 18, at: "2026-07-12T00:00:00Z" } },
          { kind: "move", subject_ref: `individual/${individualId}`, to_placement_id: placeA, at: "2026-07-12T00:00:00Z" },
          { kind: "life-event", individual_id: "does-not-exist-but-life-events-dont-404", body: {} }, // invalid schema -> fails, does NOT roll back the others
        ],
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { ok: boolean; id?: string; error?: string }[] };
    expect(body.results).toHaveLength(5);
    expect(body.results[0].ok).toBe(true);
    expect(body.results[1].ok).toBe(true);
    expect(body.results[2].ok).toBe(true);
    expect(body.results[3].ok).toBe(true);
    expect(body.results[4].ok).toBe(false); // partial failure surfaced, not hidden

    // the earlier items DID persist despite the later failure (append-only, no txn)
    const clutchDetail = (await (await get(`/api/v1/clutches/${clutchId}`, env)).json()) as { current_count: number };
    expect(clutchDetail.current_count).toBe(18);

    // second move: bundles "end the open occupancy" + "start the new one" in ONE item
    const move2 = await post(
      "/api/v1/observation/batch-commit",
      { items: [{ kind: "move", subject_ref: `individual/${individualId}`, to_placement_id: placeB, at: "2026-07-13T00:00:00Z" }] },
      env,
    );
    const move2Body = (await move2.json()) as { results: { ok: boolean }[] };
    expect(move2Body.results[0].ok).toBe(true);
    const occList = (await (await get("/api/v1/occupancy", env)).json()) as { occupancy: { phase: string | null; placement_id: string }[] };
    // 1st move = start only (no prior occupancy) -> 2nd move = end(placeA) + start(placeB) => 3 rows total
    expect(occList.occupancy).toHaveLength(3);
    expect(occList.occupancy.filter((o) => o.phase === "end")).toHaveLength(1);
    expect(occList.occupancy.filter((o) => o.phase === "start" && o.placement_id === placeB)).toHaveLength(1);
  });

  it("rejects a body with no items array, and more than 200 items", async () => {
    const { env } = ctx();
    expect((await post("/api/v1/observation/batch-commit", {}, env)).status).toBe(400);
    const items = Array.from({ length: 201 }, () => ({ kind: "capture", body: { domain: "biology" } }));
    const res = await post("/api/v1/observation/batch-commit", { items }, env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("TOO_MANY_ITEMS");
  });

  it("capture item enforces the SAME subspecies gate as solid-observation/commit", async () => {
    const { env } = ctx();
    const res = await post(
      "/api/v1/observation/batch-commit",
      { items: [{ kind: "capture", body: { domain: "biology", subspecies_candidate: "hercules" } }] },
      env,
    );
    const body = (await res.json()) as { results: { ok: boolean; error?: string }[] };
    expect(body.results[0]).toEqual({ ok: false, error: "SUBSPECIES_NOT_CONFIRMED" });
  });
});

describe("individuals list extension — stage/placement_id/last_care_at (C7 スライス2)", () => {
  it("surfaces the latest molt stage, latest occupancy start placement, and last capture time", async () => {
    const { env } = ctx();
    const indRes = await post("/api/v1/individuals", {}, env);
    const individualId = ((await indRes.json()) as { individual_id: string }).individual_id;

    // no molt/occupancy/capture yet -> nulls
    let list = (await (await get("/api/v1/individuals", env)).json()) as {
      individuals: { individual_id: string; stage: string | null; placement_id: string | null; last_care_at: string | null }[];
    };
    let row = list.individuals.find((i) => i.individual_id === individualId)!;
    expect(row.stage).toBeNull();
    expect(row.placement_id).toBeNull();
    expect(row.last_care_at).toBeNull();

    await post(`/api/v1/individuals/${individualId}/life-events`, { kind: "molt", at: "2026-07-01T00:00:00Z", detail: { to_stage: "third_early" } }, env);
    await post(`/api/v1/individuals/${individualId}/life-events`, { kind: "molt", at: "2026-07-10T00:00:00Z", detail: { to_stage: "third_late" } }, env);
    const place = ((await (await post("/api/v1/placements", { label: "Shelf A" }, env)).json()) as { placement_id: string }).placement_id;
    await post("/api/v1/occupancy", { placement_id: place, subject_ref: `individual/${individualId}` }, env);
    await post("/api/v1/observation/captures", { domain: "biology", subject_ref: `individual/${individualId}` }, env);

    list = (await (await get("/api/v1/individuals", env)).json()) as {
      individuals: { individual_id: string; stage: string | null; placement_id: string | null; last_care_at: string | null }[];
    };
    row = list.individuals.find((i) => i.individual_id === individualId)!;
    expect(row.stage).toBe("third_late"); // latest molt wins, not the first
    expect(row.placement_id).toBe(place);
    expect(row.last_care_at).not.toBeNull();
  });
});
