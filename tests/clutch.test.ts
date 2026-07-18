// C7 スライス2 TC: クラッチ(匿名プール・count層)+一括保存+occupancy 移動+個体
// 一覧拡張 (V3-AIP-101 wireframes-core5 §F3/F4). Drives the real app through the
// auth gate (DEV_TOKEN bearer), same convention as tests/individual.test.ts.
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { deriveActorId } from "@ihl/truth";
import { issueSessionToken } from "../apps/api/src/session";
import { DEV_TOKEN, FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

const AUTH = { Authorization: `Bearer ${DEV_TOKEN}` };
const AUTH_JSON = { ...AUTH, "content-type": "application/json" };
const DEV_ACTOR = await deriveActorId("dev@ihl.local");

async function bearer(actorId: string) {
  return { Authorization: `Bearer ${await issueSessionToken(actorId, SESSION_SECRET)}`, "content-type": "application/json" };
}

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

describe("clutch attrition 照合 — 水増し/行方不明検出 (V3-IND-36)", () => {
  it("recount short of the projected count flags a negative discrepancy (行方不明疑い)", async () => {
    const { env } = ctx();
    const id = await createClutch(env, { initial_count: 100 });
    // 100 匹のはずが再計測で 92 匹しかいない → 8 匹分の行方不明疑い。
    const res = await post(`/api/v1/clutches/${id}/events`, { kind: "recount", counted: 92, at: "2026-07-13T00:00:00Z" }, env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { discrepancy: number };
    expect(body.discrepancy).toBe(-8);

    const rec = (await (await get(`/api/v1/clutches/${id}/reconciliation`, env)).json()) as {
      recount_discrepancies: { counted: number; expected_before: number; discrepancy: number }[];
      has_shortfall: boolean;
      has_surplus: boolean;
    };
    expect(rec.recount_discrepancies).toHaveLength(1);
    expect(rec.recount_discrepancies[0]).toMatchObject({ counted: 92, expected_before: 100, discrepancy: -8 });
    expect(rec.has_shortfall).toBe(true);
    expect(rec.has_surplus).toBe(false);
  });

  it("recount above the projected count flags a positive discrepancy (水増し疑い)", async () => {
    const { env } = ctx();
    const id = await createClutch(env, { initial_count: 50 });
    const res = await post(`/api/v1/clutches/${id}/events`, { kind: "recount", counted: 55, at: "2026-07-13T00:00:00Z" }, env);
    const body = (await res.json()) as { discrepancy: number };
    expect(body.discrepancy).toBe(5);

    const rec = (await (await get(`/api/v1/clutches/${id}/reconciliation`, env)).json()) as {
      has_shortfall: boolean;
      has_surplus: boolean;
    };
    expect(rec.has_shortfall).toBe(false);
    expect(rec.has_surplus).toBe(true);
  });

  it("reconciliation aggregates total_promoted/total_attrition_death across the full event history; unknown clutch -> 404", async () => {
    const { env } = ctx();
    const id = await createClutch(env, { initial_count: 68 });
    await post(`/api/v1/clutches/${id}/events`, { kind: "attrition", death_count: 3, at: "2026-07-13T00:00:00Z" }, env);
    await post(`/api/v1/clutches/${id}/promote`, { count: 60, death_count: 5, at: "2026-08-01T00:00:00Z" }, env);

    const rec = (await (await get(`/api/v1/clutches/${id}/reconciliation`, env)).json()) as {
      total_promoted: number;
      total_attrition_death: number;
      current_count: number;
      has_shortfall: boolean;
      has_surplus: boolean;
    };
    expect(rec.total_promoted).toBe(60);
    expect(rec.total_attrition_death).toBe(8); // 3 (attrition) + 5 (promote's own death_count)
    expect(rec.current_count).toBe(0); // 68 - 3 - 60 - 5
    expect(rec.has_shortfall).toBe(false); // no recount events -> no discrepancies at all
    expect(rec.has_surplus).toBe(false);

    expect((await get("/api/v1/clutches/nope/reconciliation", env)).status).toBe(404);
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

describe("clutch promote ownership guard (fail-closed — promote mints individuals, so only the clutch's creator may promote it)", () => {
  it("route: actor B promoting actor A's clutch -> 403 NOT_OWNER, no individuals minted, no promote event; actor A promoting own clutch still succeeds", async () => {
    const { bucket, env } = ctx();
    const aH = await bearer("actor-a");
    const bH = await bearer("actor-b");

    const createRes = await app.request(
      "/api/v1/clutches",
      { method: "POST", headers: aH, body: JSON.stringify({ harvested_at: "2026-07-12", initial_count: 10 }) },
      env,
    );
    expect(createRes.status).toBe(201);
    const clutchId = ((await createRes.json()) as { clutch_id: string }).clutch_id;

    const stolen = await app.request(
      `/api/v1/clutches/${clutchId}/promote`,
      { method: "POST", headers: bH, body: JSON.stringify({ count: 3, at: "2026-08-01T00:00:00Z" }) },
      env,
    );
    expect(stolen.status).toBe(403);
    expect(await stolen.json()).toEqual({ error: "NOT_OWNER" });

    // no write happened: zero individual masters, zero promote clutch-events
    const masterKeys = [...bucket.objects.keys()].filter((k) => k.startsWith("truth/ihl.ind.master.v1/"));
    expect(masterKeys).toHaveLength(0);
    const eventKeys = [...bucket.objects.keys()].filter((k) => k.startsWith(`truth/ihl.ind.clutch_event.v1/${clutchId}-`));
    expect(eventKeys).toHaveLength(0);

    // actor A (the real owner) promoting the same clutch still works
    const legit = await app.request(
      `/api/v1/clutches/${clutchId}/promote`,
      { method: "POST", headers: aH, body: JSON.stringify({ count: 3, at: "2026-08-01T00:00:00Z" }) },
      env,
    );
    expect(legit.status).toBe(201);
    const legitBody = (await legit.json()) as { individual_ids: string[] };
    expect(legitBody.individual_ids).toHaveLength(3);
  });

  it("batch-commit: actor B's promote item for actor A's clutch is a per-item NOT_OWNER failure, no individuals minted, and other items in the same batch still commit", async () => {
    const { bucket, env } = ctx();
    const aH = await bearer("actor-a");
    const bH = await bearer("actor-b");

    const aClutchRes = await app.request(
      "/api/v1/clutches",
      { method: "POST", headers: aH, body: JSON.stringify({ harvested_at: "2026-07-12", initial_count: 10 }) },
      env,
    );
    const aClutchId = ((await aClutchRes.json()) as { clutch_id: string }).clutch_id;

    const bClutchRes = await app.request(
      "/api/v1/clutches",
      { method: "POST", headers: bH, body: JSON.stringify({ harvested_at: "2026-07-12", initial_count: 5 }) },
      env,
    );
    const bClutchId = ((await bClutchRes.json()) as { clutch_id: string }).clutch_id;

    const res = await app.request(
      "/api/v1/observation/batch-commit",
      {
        method: "POST",
        headers: bH,
        body: JSON.stringify({
          items: [
            { kind: "promote", clutch_id: aClutchId, count: 3, at: "2026-08-01T00:00:00Z" }, // B stealing A's clutch
            { kind: "promote", clutch_id: bClutchId, count: 2, at: "2026-08-01T00:00:00Z" }, // B's own clutch — must still succeed
            { kind: "capture", body: { domain: "biology", subject_ref: `clutch/${bClutchId}`, measurements: [] } }, // unrelated item — must still succeed
          ],
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { ok: boolean; id?: string; error?: string }[] };
    expect(body.results).toHaveLength(3);
    expect(body.results[0]).toEqual({ ok: false, error: "NOT_OWNER" });
    expect(body.results[1]).toEqual({ ok: true, id: bClutchId });
    expect(body.results[2].ok).toBe(true);

    // exactly 2 individuals minted (from B's own promote), none from A's stolen clutch
    const masterKeys = [...bucket.objects.keys()].filter((k) => k.startsWith("truth/ihl.ind.master.v1/"));
    expect(masterKeys).toHaveLength(2);
    const aEventKeys = [...bucket.objects.keys()].filter((k) => k.startsWith(`truth/ihl.ind.clutch_event.v1/${aClutchId}-`));
    expect(aEventKeys).toHaveLength(0); // A's clutch untouched
  });
});

describe("V3-IND-02 但し書き — アドレス(individual層のUID)は昇格(promote)時にしか発生しない", () => {
  it("count層のまま(promote前)は個体マスタが1件も存在せず、promote後にちょうど count 件だけ現れる", async () => {
    const { env } = ctx();
    const id = await createClutch(env, { initial_count: 20 });
    const before = (await (await get("/api/v1/individuals", env)).json()) as { individuals: unknown[] };
    expect(before.individuals).toHaveLength(0); // count層は匿名プールのまま — 個体UIDはまだ無い

    const promote = await post(`/api/v1/clutches/${id}/promote`, { count: 3, at: "2026-08-01T00:00:00Z" }, env);
    expect(promote.status).toBe(201);
    const after = (await (await get("/api/v1/individuals", env)).json()) as { individuals: unknown[] };
    expect(after.individuals).toHaveLength(3); // 個別容器分割の瞬間に生成されたぶんだけ
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

  it("rejects a body with no items array, and more than BATCH_MAX_ITEMS(1000) items (PPR-12 raised the cap for Recompute All 1000枚一括)", async () => {
    const { env } = ctx();
    expect((await post("/api/v1/observation/batch-commit", {}, env)).status).toBe(400);
    const items = Array.from({ length: 1001 }, () => ({ kind: "capture", body: { domain: "biology" } }));
    const res = await post("/api/v1/observation/batch-commit", { items }, env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("TOO_MANY_ITEMS");
  });

  it("kind:promote performs the same effect as the direct route (individuals issued, current_count drops), and reports per-item results without failing the whole batch", async () => {
    const { env } = ctx();
    const clutchId = await createClutch(env, { initial_count: 10, species: "Dynastes hercules" });

    const res = await post(
      "/api/v1/observation/batch-commit",
      {
        items: [
          { kind: "promote", clutch_id: clutchId, count: 4, death_count: 1, at: "2026-08-01T00:00:00Z" },
          { kind: "promote", clutch_id: "nope-does-not-exist", count: 1, at: "2026-08-01T00:00:00Z" }, // per-item failure, not a whole-batch 500
          { kind: "promote", clutch_id: clutchId, body: {} }, // missing count -> per-item failure
        ],
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { ok: boolean; id?: string; error?: string }[] };
    expect(body.results).toHaveLength(3);
    expect(body.results[0]).toEqual({ ok: true, id: clutchId });
    expect(body.results[1]).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(body.results[2]).toEqual({ ok: false, error: "INVALID_ITEM" });

    // same effect as POST /clutches/:id/promote: current_count dropped by count+death_count,
    // and exactly `count` new individuals exist (address/UID only exists after promote).
    const clutchDetail = (await (await get(`/api/v1/clutches/${clutchId}`, env)).json()) as { current_count: number };
    expect(clutchDetail.current_count).toBe(5); // 10 - 4 - 1
    const individuals = (await (await get("/api/v1/individuals", env)).json()) as { individuals: { species: string }[] };
    expect(individuals.individuals).toHaveLength(4);
    expect(individuals.individuals.every((i) => i.species === "Dynastes hercules")).toBe(true);
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
