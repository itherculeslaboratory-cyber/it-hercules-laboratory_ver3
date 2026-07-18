// FND-18 source ingest TC (design-k7 §3). Mounts the exported sourceRoutes module
// on its own Hono app (NOT yet wired into index.ts — wiring is package 6) with the
// in-memory FakeR2Bucket, an actorId middleware standing in for the session gate.
// ASCII test names. Covers: telemetry bucketize written/skipped_duplicate/
// skipped_invalid counts, 1-min -> 5-min mean aggregation, device-binding open
// dup 409, placement/occupancy INSERT + put-if-absent 409, actor_id forced.
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import { sourceRoutes } from "../apps/api/src/source-routes";
import { bucketize, TELEMETRY_BUCKET_MS, TELEMETRY_SOURCE_MS } from "../apps/api/src/telemetry-merge";
import type { Bindings, Variables } from "../apps/api/src/env";
import { FakeR2Bucket, makeEnv } from "./helpers";

const ACTOR = "actor-a";
const JSON_HEADERS = { "content-type": "application/json" };

function ctx(actorId = ACTOR) {
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("actorId", actorId);
    c.set("roles", []);
    await next();
  });
  app.route("/api/v1", sourceRoutes);
  const bucket = new FakeR2Bucket();
  return { app, bucket, env: makeEnv(bucket) };
}
async function post(app: Hono<{ Bindings: Bindings; Variables: Variables }>, env: object, path: string, body: unknown) {
  return app.request(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) }, env);
}
async function get(app: Hono<{ Bindings: Bindings; Variables: Variables }>, env: object, path: string) {
  return app.request(path, {}, env);
}

describe("FND-18 telemetry bucketize (pure)", () => {
  it("aggregates 1-min rows into 5-min buckets by device and metric", () => {
    const rows = [
      { device_id: "dev-1", ts_ms: 0, metric: "temp", value: 10 },
      { device_id: "dev-1", ts_ms: TELEMETRY_SOURCE_MS, metric: "temp", value: 20 },
      { device_id: "dev-1", ts_ms: 2 * TELEMETRY_SOURCE_MS, metric: "temp", value: 30 },
      { device_id: "dev-1", ts_ms: TELEMETRY_BUCKET_MS, metric: "temp", value: 40 },
      { device_id: "dev-1", ts_ms: TELEMETRY_BUCKET_MS + TELEMETRY_SOURCE_MS, metric: "temp", value: 60 },
      // same bucket as the first group but a DIFFERENT metric -> its own bucket
      { device_id: "dev-1", ts_ms: 0, metric: "humid", value: 50 },
    ];
    const out = bucketize(rows).sort((a, b) => a.bucket_start_ms - b.bucket_start_ms || a.metric.localeCompare(b.metric));
    expect(out).toHaveLength(3);

    const temp0 = out.find((b) => b.metric === "temp" && b.bucket_start_ms === 0)!;
    expect(temp0.mean).toBe(20); // (10+20+30)/3
    expect(temp0.count).toBe(3);
    expect(temp0.source_granularity_ms).toBe(TELEMETRY_SOURCE_MS);

    const temp1 = out.find((b) => b.metric === "temp" && b.bucket_start_ms === TELEMETRY_BUCKET_MS)!;
    expect(temp1.mean).toBe(50); // (40+60)/2
    expect(temp1.count).toBe(2);

    const humid0 = out.find((b) => b.metric === "humid")!;
    expect(humid0.mean).toBe(50);
    expect(humid0.count).toBe(1);
  });

  it("drops invalid rows (NaN value, missing metric, bad timestamp)", () => {
    const rows = [
      { device_id: "dev-1", ts_ms: 0, metric: "temp", value: 10 },
      { device_id: "dev-1", ts_ms: 0, metric: "temp", value: NaN }, // NaN
      { device_id: "dev-1", ts_ms: 0, value: 5 }, // missing metric
      { device_id: "dev-1", ts_ms: -1, metric: "temp", value: 5 }, // bad ts
      { ts_ms: 0, metric: "temp", value: 5 }, // missing device_id
    ];
    const out = bucketize(rows);
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(1); // only the one valid row
  });
});

describe("FND-18 telemetry ingest route (idempotent merge)", () => {
  it("counts written / skipped_invalid / skipped_duplicate", async () => {
    const { app, env } = ctx();
    const rows = [
      { device_id: "dev-1", ts_ms: 0, metric: "temp", value: 10 },
      { device_id: "dev-1", ts_ms: TELEMETRY_SOURCE_MS, metric: "temp", value: 20 },
      { device_id: "dev-1", ts_ms: 0, metric: "temp", value: NaN }, // invalid
      { device_id: "dev-1", ts_ms: 0, value: 1 }, // invalid (no metric)
    ];
    const res1 = await post(app, env, "/api/v1/telemetry", { rows });
    expect(res1.status).toBe(202);
    expect(await res1.json()).toEqual({ written: 1, skipped_duplicate: 0, skipped_invalid: 2 });

    // resend the same valid rows -> same bucket key -> put-if-absent 409 -> duplicate
    const res2 = await post(app, env, "/api/v1/telemetry", { rows });
    expect(await res2.json()).toEqual({ written: 0, skipped_duplicate: 1, skipped_invalid: 2 });
  });

  it("hyphenated device/metric pairs do not collide on the Truth key (a-b,c vs a,b-c)", async () => {
    const { app, env, bucket } = ctx();
    const rows = [
      { device_id: "a-b", ts_ms: 0, metric: "c", value: 1 },
      { device_id: "a", ts_ms: 0, metric: "b-c", value: 2 },
    ];
    const res = await post(app, env, "/api/v1/telemetry", { rows });
    expect(res.status).toBe(202);
    // both buckets persist as distinct events — no false skipped_duplicate data loss
    expect(await res.json()).toEqual({ written: 2, skipped_duplicate: 0, skipped_invalid: 0 });
    const keys = [...bucket.objects.keys()].filter((k) => k.startsWith("truth/ihl.src.telemetry.v1/"));
    expect(keys).toHaveLength(2);
  });
});

describe("FND-18 device binding lifecycle", () => {
  it("open dup -> 409; end = new insert; rebind after end OK; double end -> 409", async () => {
    const { app, env, bucket } = ctx();
    const r1 = await post(app, env, "/api/v1/device-bindings", { device_id: "dev-1", placement_id: "plc-1" });
    expect(r1.status).toBe(201);
    const bindingId = ((await r1.json()) as { binding_id: string }).binding_id;

    // same device with an open binding -> 409
    const dup = await post(app, env, "/api/v1/device-bindings", { device_id: "dev-1", placement_id: "plc-2" });
    expect(dup.status).toBe(409);

    // end = a NEW insert, the start event is untouched
    const end = await post(app, env, "/api/v1/device-bindings/end", { binding_id: bindingId });
    expect(end.status).toBe(201);
    const startStill = await new TruthStore(bucket).readEvent(`truth/ihl.src.device_binding.v1/${bindingId}-start.json`);
    expect((startStill!.data as { phase: string }).phase).toBe("start"); // NOT updated to end

    // ending again -> 409 (put-if-absent on the -end key)
    const endAgain = await post(app, env, "/api/v1/device-bindings/end", { binding_id: bindingId });
    expect(endAgain.status).toBe(409);

    // device is now free -> rebinding succeeds
    const rebind = await post(app, env, "/api/v1/device-bindings", { device_id: "dev-1", placement_id: "plc-2" });
    expect(rebind.status).toBe(201);

    const list = (await (await get(app, env, "/api/v1/device-bindings")).json()) as { bindings: { open: boolean }[] };
    expect(list.bindings).toHaveLength(2);
    expect(list.bindings.filter((b) => b.open)).toHaveLength(1);
  });

  it("ending an unknown binding -> 404", async () => {
    const { app, env } = ctx();
    const res = await post(app, env, "/api/v1/device-bindings/end", { binding_id: "nope" });
    expect(res.status).toBe(404);
  });
});

describe("FND-18 placement + occupancy INSERT (put-if-absent)", () => {
  it("placement insert forces actor_id from session, not body", async () => {
    const { app, env, bucket } = ctx();
    const res = await post(app, env, "/api/v1/placements", { label: "Shelf A", actor_id: "attacker" });
    expect(res.status).toBe(201);
    const placementId = ((await res.json()) as { placement_id: string }).placement_id;

    const key = `truth/ihl.src.placement.v1/${placementId}.json`;
    const rec = await new TruthStore(bucket).readEvent(key);
    expect((rec!.data as { actor_id: string }).actor_id).toBe(ACTOR); // NOT "attacker"

    // list is 本人スコープ and shows the row
    const list = (await (await get(app, env, "/api/v1/placements")).json()) as { placements: { label: string }[] };
    expect(list.placements).toHaveLength(1);
    expect(list.placements[0].label).toBe("Shelf A");

    // the underlying store is put-if-absent: a second write to the same key is 409
    const dup = await new TruthStore(bucket).putEventAt(key, rec);
    expect(dup.status).toBe("conflict");
  });

  it("placement without label -> 400; occupancy insert then list", async () => {
    const { app, env, bucket } = ctx();
    expect((await post(app, env, "/api/v1/placements", {})).status).toBe(400);

    // occupancy authz (Task 1): linking individual/ind-1 requires the caller to
    // own it — seed a master owned by ACTOR directly (sourceRoutes-only mount
    // has no individualRoutes to create it via API), same shape as
    // createIndividualMaster (individual-routes.ts).
    await new TruthStore(bucket).putEventAt("truth/ihl.ind.master.v1/ind-1.json", {
      specversion: "1.0",
      id: ulid(),
      source: "test",
      type: "ihl.ind.master.v1",
      time: new Date().toISOString(),
      dataschema: "schemas/events/ind-master.schema.json",
      provenance: { generator_kind: "human", actor_id: ACTOR },
      data: { individual_id: "ind-1", actor_id: ACTOR, created_at: new Date().toISOString() },
    });

    const occ = await post(app, env, "/api/v1/occupancy", { placement_id: "plc-1", subject_ref: "individual/ind-1" });
    expect(occ.status).toBe(201);
    const list = (await (await get(app, env, "/api/v1/occupancy")).json()) as { occupancy: unknown[] };
    expect(list.occupancy).toHaveLength(1);
  });

  it("occupancy for an individual NOT owned by the caller -> 403 NOT_OWNER, no write", async () => {
    const { app, env, bucket } = ctx();
    await new TruthStore(bucket).putEventAt("truth/ihl.ind.master.v1/ind-other.json", {
      specversion: "1.0",
      id: ulid(),
      source: "test",
      type: "ihl.ind.master.v1",
      time: new Date().toISOString(),
      dataschema: "schemas/events/ind-master.schema.json",
      provenance: { generator_kind: "human", actor_id: "someone-else" },
      data: { individual_id: "ind-other", actor_id: "someone-else", created_at: new Date().toISOString() },
    });
    const occ = await post(app, env, "/api/v1/occupancy", { placement_id: "plc-1", subject_ref: "individual/ind-other" });
    expect(occ.status).toBe(403);
    expect(await occ.json()).toEqual({ error: "NOT_OWNER" });
    const list = (await (await get(app, env, "/api/v1/occupancy")).json()) as { occupancy: unknown[] };
    expect(list.occupancy).toHaveLength(0);
  });
});

// V3-OBS-72 研究室環境コンテキスト: placement 基盤の拡張(部屋/空調/センサー
// 位置)。append-only history + 最新1件投影(projectLabEnvironmentAt)。
describe("V3-OBS-72 lab environment (placement 拡張・append-only latest-wins projection)", () => {
  it("room_label required -> 400; a valid record round-trips via GET", async () => {
    const { app, env } = ctx();
    const { placement_id } = (await (await post(app, env, "/api/v1/placements", { label: "棚A" })).json()) as {
      placement_id: string;
    };

    expect((await post(app, env, `/api/v1/placements/${placement_id}/lab-environment`, {})).status).toBe(400);

    const res = await post(app, env, `/api/v1/placements/${placement_id}/lab-environment`, {
      room_label: "飼育室2・北側",
      hvac_profile: "24℃・湿度55%設定",
      sensor_position: "棚の中段",
    });
    expect(res.status).toBe(201);

    const got = (await (await get(app, env, `/api/v1/placements/${placement_id}/lab-environment`)).json()) as {
      lab_environment: { room_label: string; hvac_profile: string; sensor_position: string };
    };
    expect(got.lab_environment.room_label).toBe("飼育室2・北側");
    expect(got.lab_environment.hvac_profile).toBe("24℃・湿度55%設定");
    expect(got.lab_environment.sensor_position).toBe("棚の中段");
  });

  it("a placement with no recorded environment reads as null, not 404 (V3-UIX-03)", async () => {
    const { app, env } = ctx();
    const { placement_id } = (await (await post(app, env, "/api/v1/placements", { label: "空の棚" })).json()) as {
      placement_id: string;
    };
    const res = await get(app, env, `/api/v1/placements/${placement_id}/lab-environment`);
    expect(res.status).toBe(200);
    expect((await res.json()) as { lab_environment: unknown }).toEqual({ placement_id, lab_environment: null });
  });

  it("appending a second record supersedes the first on read (append-only latest-wins)", async () => {
    const { app, env } = ctx();
    const { placement_id } = (await (await post(app, env, "/api/v1/placements", { label: "棚B" })).json()) as {
      placement_id: string;
    };
    await post(app, env, `/api/v1/placements/${placement_id}/lab-environment`, { room_label: "旧・飼育室1" });
    await new Promise((r) => setTimeout(r, 2)); // distinct created_at ordering
    await post(app, env, `/api/v1/placements/${placement_id}/lab-environment`, { room_label: "新・飼育室3" });

    const got = (await (await get(app, env, `/api/v1/placements/${placement_id}/lab-environment`)).json()) as {
      lab_environment: { room_label: string };
    };
    expect(got.lab_environment.room_label).toBe("新・飼育室3");
  });
});
