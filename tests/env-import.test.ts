// V3-OBS-32 CSV import TC (docs/planning/c7/usecase-driven-design.md
// §machines-environment-io). Mounts envImportRoutes on its own Hono app (fnd-18
// pattern) with the in-memory FakeR2Bucket + an actorId middleware standing in
// for the session gate. Covers: real-data golden fixture import (SwitchBot
// preset auto-detect, with/without Light_Value) · generic column_mapping
// override · invalid-row skip+count · 200,000-row/16MB chunk-boundary rejection
// (built by duplicating the real fixture data, per tests/fixtures/
// csv-import-golden/README.md) · duplicate re-import idempotency (put-if-absent
// skip) · dry-run preview (no write) · OQ-LB-02 read-back projection
// (source-count-max across csv/collector snapshots sharing a logical bucket).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { TruthStore } from "@ihl/truth";
import { envImportRoutes } from "../apps/api/src/env-import-routes";
import { ingestTelemetryBuckets, projectTelemetryLatest } from "../apps/api/src/source-routes";
import { bucketize, type TelemetryBucket } from "../apps/api/src/telemetry-merge";
import { CSV_MAX_BYTES, CSV_MAX_ROWS, isParseError, parseEnvCsv } from "../apps/api/src/csv-import";
import type { Bindings, Variables } from "../apps/api/src/env";
import { FakeR2Bucket, makeEnv } from "./helpers";

const ACTOR = "actor-obs32";

function ctx(actorId = ACTOR) {
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("actorId", actorId);
    c.set("roles", []);
    await next();
  });
  app.route("/api/v1", envImportRoutes);
  const bucket = new FakeR2Bucket();
  return { app, bucket, env: makeEnv(bucket) };
}

function csvForm(opts: {
  csv: string;
  deviceId?: string;
  placementId?: string;
  dryRun?: boolean;
  columnMapping?: unknown;
  omitFile?: boolean;
  omitDevice?: boolean;
}): FormData {
  const fd = new FormData();
  if (!opts.omitFile) fd.append("file", new Blob([opts.csv], { type: "text/csv" }), "import.csv");
  if (!opts.omitDevice) fd.append("device_id", opts.deviceId ?? "dev-1");
  if (opts.placementId) fd.append("placement_id", opts.placementId);
  if (opts.dryRun) fd.append("dry_run", "true");
  if (opts.columnMapping !== undefined) fd.append("column_mapping", JSON.stringify(opts.columnMapping));
  return fd;
}

async function importCsv(app: Hono<{ Bindings: Bindings; Variables: Variables }>, env: object, form: FormData) {
  return app.request("/api/v1/obs/env-import", { method: "POST", body: form }, env);
}
async function latest(app: Hono<{ Bindings: Bindings; Variables: Variables }>, env: object, query: string) {
  return app.request(`/api/v1/obs/telemetry/latest?${query}`, {}, env);
}

function loadCsvFixture(name: string): { header: string; dataLines: string[] } {
  const url = new URL(`./fixtures/csv-import-golden/${name}`, import.meta.url);
  const text = readFileSync(url, "utf8");
  const lines = text.split(/\r?\n/).filter((l, i, arr) => !(i === arr.length - 1 && l === ""));
  return { header: lines[0], dataLines: lines.slice(1) };
}

const HUB3 = loadCsvFixture("hub3-7e.csv"); // 7 cols incl. Light_Value
const MAT = loadCsvFixture("mat-center-temp-11l.csv"); // 6 cols, no Light_Value

describe("V3-OBS-32 real-data golden fixture import (SwitchBot preset auto-detect)", () => {
  it("imports a hub3-7e slice (Light_Value present) and matches the pure bucketize() ground truth", async () => {
    const { app, bucket, env } = ctx();
    const slice = HUB3.dataLines.slice(0, 300);
    const csvText = [HUB3.header, ...slice].join("\n");

    const expected = parseEnvCsv(csvText, "dev-hub3-7e");
    if (isParseError(expected)) throw new Error(`fixture unexpectedly failed to parse: ${expected.error}`);
    expect(expected.metrics.sort()).toEqual(
      ["abs_humidity", "dew_point", "humidity", "light", "temperature", "vpd"].sort(),
    );
    const expectedBuckets = bucketize(expected.rows);

    const res = await importCsv(app, env, csvForm({ csv: csvText, deviceId: "dev-hub3-7e" }));
    expect(res.status).toBe(202);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      device_id: "dev-hub3-7e",
      placement_id: null,
      dry_run: false,
      csv_rows_read: 300,
      invalid_rows: 0,
      written: expectedBuckets.length,
      skipped_duplicate: 0,
      skipped_invalid: 0,
    });

    // Truth keys carry the csv source segment (OQ-LB-02 bucket key extension).
    const keys = [...bucket.objects.keys()].filter((k) => k.startsWith("truth/ihl.src.telemetry.v1/"));
    expect(keys).toHaveLength(expectedBuckets.length);
    expect(keys.every((k) => k.endsWith("-csv.json"))).toBe(true);

    // re-import the SAME file → full idempotent skip (put-if-absent, 不変条項③).
    const res2 = await importCsv(app, env, csvForm({ csv: csvText, deviceId: "dev-hub3-7e" }));
    const body2 = (await res2.json()) as Record<string, unknown>;
    expect(body2).toMatchObject({ written: 0, skipped_duplicate: expectedBuckets.length, invalid_rows: 0 });
  });

  it("imports a mat-center-temp slice (no Light_Value column) — 'light' metric never appears", async () => {
    const { app, env } = ctx();
    const slice = MAT.dataLines.slice(0, 120);
    const csvText = [MAT.header, ...slice].join("\n");

    const res = await importCsv(app, env, csvForm({ csv: csvText, deviceId: "dev-mat-center" }));
    expect(res.status).toBe(202);
    const body = (await res.json()) as { written: number; invalid_rows: number };
    expect(body.invalid_rows).toBe(0);
    expect(body.written).toBeGreaterThan(0);

    const lightRes = await latest(app, env, "device_id=dev-mat-center&metric=light");
    expect(((await lightRes.json()) as { readings: unknown[] }).readings).toEqual([]);
    const tempRes = await latest(app, env, "device_id=dev-mat-center&metric=temperature");
    expect(((await tempRes.json()) as { readings: unknown[] }).readings.length).toBeGreaterThan(0);
  });
});

describe("V3-OBS-32 generic column mapping (non-SwitchBot header)", () => {
  it("accepts an explicit column_mapping override and bucketizes it", async () => {
    const { app, env } = ctx();
    const csvText = ["ts,t", "2026-01-01 00:00,20", "2026-01-01 00:01,21", "2026-01-01 00:02,22"].join("\n");

    const res = await importCsv(
      app,
      env,
      csvForm({ csv: csvText, deviceId: "dev-generic", columnMapping: { timestamp_column: "ts", metrics: { t: "temperature" } } }),
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as { csv_rows_read: number; written: number; invalid_rows: number };
    expect(body).toMatchObject({ csv_rows_read: 3, invalid_rows: 0, written: 1 }); // all 3 rows share one 5-min bucket

    const readings = ((await (await latest(app, env, "device_id=dev-generic&metric=temperature")).json()) as {
      readings: { mean: number; count: number; source: string }[];
    }).readings;
    expect(readings).toEqual([expect.objectContaining({ mean: 21, count: 3, source: "csv" })]);
  });

  it("no override + unrecognized header → UNRESOLVED_COLUMN_MAPPING (400)", async () => {
    const { app, env } = ctx();
    const csvText = ["foo,bar", "1,2"].join("\n");
    const res = await importCsv(app, env, csvForm({ csv: csvText, deviceId: "dev-x" }));
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "UNRESOLVED_COLUMN_MAPPING" });
  });
});

describe("V3-OBS-32 invalid-row skip + count (negative TC)", () => {
  it("skips a bad-timestamp row and a wrong-column-count row, reports invalid_rows=2", async () => {
    const { app, env } = ctx();
    const good1 = HUB3.dataLines[0];
    const good2 = HUB3.dataLines[1];
    const badTimestamp = "not-a-date,20.5,41,6.8,1.42,7.30,1"; // 7 cols, unparseable ts
    const wrongColumnCount = "2026-03-21 20:19,21.0,43,7.9,1.42,7.88"; // 6 cols (header has 7)
    const csvText = [HUB3.header, good1, good2, badTimestamp, wrongColumnCount].join("\n");

    const res = await importCsv(app, env, csvForm({ csv: csvText, deviceId: "dev-bad-rows" }));
    expect(res.status).toBe(202);
    const body = (await res.json()) as { csv_rows_read: number; invalid_rows: number; written: number };
    expect(body.csv_rows_read).toBe(4);
    expect(body.invalid_rows).toBe(2);
    expect(body.written).toBeGreaterThan(0); // the 2 good rows still land somewhere
  });

  it("missing file or device_id → INVALID_IMPORT (400)", async () => {
    const { app, env } = ctx();
    const noFile = await importCsv(app, env, csvForm({ csv: "a,b\n1,2", omitFile: true }));
    expect(noFile.status).toBe(400);
    const noDevice = await importCsv(app, env, csvForm({ csv: "a,b\n1,2", omitDevice: true }));
    expect(noDevice.status).toBe(400);
  });

  it("malformed column_mapping JSON → INVALID_COLUMN_MAPPING (400)", async () => {
    const { app, env } = ctx();
    const fd = csvForm({ csv: "a,b\n1,2", deviceId: "dev-x" });
    fd.set("column_mapping", "{not json");
    const res = await importCsv(app, env, fd);
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "INVALID_COLUMN_MAPPING" });
  });
});

describe("V3-OBS-32 200,000-row / 16MB chunk-boundary limits (real fixture data duplicated per golden README)", () => {
  // README: "200,000行/16MBには各ファイル単体では達しない。チャンク分割の境界テストには
  // この2ファイルを結合するか複製して閾値超えを作る必要がある。"
  // ponytail: index-modulo instead of `out.push(...lines)` — spreading a
  // 138k-element array repeatedly blows V8's call-stack argument limit.
  function repeat(lines: string[], count: number): string[] {
    const out: string[] = new Array(count);
    for (let i = 0; i < count; i++) out[i] = lines[i % lines.length];
    return out;
  }

  it("accepts exactly 200,000 rows (row-count boundary, at the limit)", () => {
    const rows = repeat(HUB3.dataLines, CSV_MAX_ROWS);
    const csvText = [HUB3.header, ...rows].join("\n");
    const parsed = parseEnvCsv(csvText, "dev-boundary");
    expect(isParseError(parsed)).toBe(false);
    if (!isParseError(parsed)) expect(parsed.csv_rows_read).toBe(CSV_MAX_ROWS);
  });

  it("rejects 200,001 rows while staying under 16MB (row-count-only breach)", () => {
    const rows = repeat(HUB3.dataLines, CSV_MAX_ROWS + 1);
    const csvText = [HUB3.header, ...rows].join("\n");
    expect(new TextEncoder().encode(csvText).byteLength).toBeLessThan(CSV_MAX_BYTES);
    const parsed = parseEnvCsv(csvText, "dev-boundary");
    expect(parsed).toMatchObject({ error: "CSV_TOO_MANY_ROWS", details: { max_rows: CSV_MAX_ROWS, actual_rows: CSV_MAX_ROWS + 1 } });
  });

  it("rejects a CSV whose byte size exceeds 16MB (built by duplicating real rows)", () => {
    // ~43 bytes/real row × ~450k rows clears 16MB with margin.
    const rows = repeat(HUB3.dataLines, 450_000);
    const csvText = [HUB3.header, ...rows].join("\n");
    const byteLength = new TextEncoder().encode(csvText).byteLength;
    expect(byteLength).toBeGreaterThan(CSV_MAX_BYTES);
    const parsed = parseEnvCsv(csvText, "dev-boundary");
    expect(parsed).toMatchObject({ error: "CSV_TOO_LARGE" });
  });

  it("the HTTP route itself rejects an over-16MB upload with 400 CSV_TOO_LARGE (not a 500/timeout)", async () => {
    const { app, env } = ctx();
    const rows = repeat(HUB3.dataLines, 450_000);
    const csvText = [HUB3.header, ...rows].join("\n");
    const res = await importCsv(app, env, csvForm({ csv: csvText, deviceId: "dev-huge" }));
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "CSV_TOO_LARGE" });
  }, 20_000);
});

describe("V3-OBS-32 dry-run preview (no write)", () => {
  it("dry_run=true reports would-be counts without persisting; a real re-import afterward still writes fresh buckets", async () => {
    const { app, bucket, env } = ctx();
    const slice = HUB3.dataLines.slice(0, 60);
    const csvText = [HUB3.header, ...slice].join("\n");

    const dry = await importCsv(app, env, csvForm({ csv: csvText, deviceId: "dev-dry", dryRun: true }));
    expect(dry.status).toBe(200);
    const dryBody = (await dry.json()) as { dry_run: boolean; written: number; skipped_duplicate: number };
    expect(dryBody.dry_run).toBe(true);
    expect(dryBody.written).toBeGreaterThan(0);
    expect(bucket.objects.size).toBe(0); // nothing persisted by the preview

    const real = await importCsv(app, env, csvForm({ csv: csvText, deviceId: "dev-dry", dryRun: false }));
    const realBody = (await real.json()) as { written: number };
    expect(realBody.written).toBe(dryBody.written); // preview matched the real outcome
    expect(bucket.objects.size).toBe(realBody.written);

    // dry-running again now that the buckets are real → previews full skip.
    const dry2 = await importCsv(app, env, csvForm({ csv: csvText, deviceId: "dev-dry", dryRun: true }));
    const dry2Body = (await dry2.json()) as { written: number; skipped_duplicate: number };
    expect(dry2Body).toMatchObject({ written: 0, skipped_duplicate: realBody.written });
    expect(bucket.objects.size).toBe(realBody.written); // still untouched by the preview
  });
});

describe("V3-OBS-32 / OQ-LB-02 read-back projection (source-count-max across csv/collector)", () => {
  const B = 1_800_000_000_000; // arbitrary aligned bucket_start_ms — direct-insert test, not fed through bucketize()

  it("picks the higher source-count snapshot regardless of which source wrote it", async () => {
    const { app, bucket, env } = ctx();
    const st = new TruthStore(bucket);
    const partial: TelemetryBucket = { device_id: "dev-lb", bucket_start_ms: B, metric: "temperature", mean: 20, count: 3, source_granularity_ms: 60_000 };
    const complete: TelemetryBucket = { device_id: "dev-lb", bucket_start_ms: B, metric: "temperature", mean: 21, count: 5, source_granularity_ms: 60_000 };
    await ingestTelemetryBuckets(st, ACTOR, [partial], "collector");
    await ingestTelemetryBuckets(st, ACTOR, [complete], "csv");

    // both snapshots persist under DISTINCT keys — append-only, no overwrite (不変条項③).
    const keys = [...bucket.objects.keys()].filter((k) => k.startsWith("truth/ihl.src.telemetry.v1/"));
    expect(keys).toHaveLength(2);

    const readings = ((await (await latest(app, env, "device_id=dev-lb&metric=temperature")).json()) as {
      readings: { count: number; source: string; mean: number }[];
    }).readings;
    expect(readings).toEqual([expect.objectContaining({ count: 5, source: "csv", mean: 21 })]);
  });

  it("ties prefer source=csv over collector (design-c7 machines-environment-io 手順11)", async () => {
    const { app, bucket, env } = ctx();
    const st = new TruthStore(bucket);
    const collectorSnap: TelemetryBucket = { device_id: "dev-tie", bucket_start_ms: B, metric: "humidity", mean: 50, count: 4, source_granularity_ms: 60_000 };
    const csvSnap: TelemetryBucket = { device_id: "dev-tie", bucket_start_ms: B, metric: "humidity", mean: 52, count: 4, source_granularity_ms: 60_000 };
    await ingestTelemetryBuckets(st, ACTOR, [collectorSnap], "collector");
    await ingestTelemetryBuckets(st, ACTOR, [csvSnap], "csv");

    const readings = await projectTelemetryLatest(bucket, "dev-tie", "humidity");
    expect(readings).toEqual([expect.objectContaining({ count: 4, source: "csv", mean: 52 })]);
  });

  it("GET without device_id → 400", async () => {
    const { app, env } = ctx();
    const res = await app.request("/api/v1/obs/telemetry/latest", {}, env);
    expect(res.status).toBe(400);
  });
});
