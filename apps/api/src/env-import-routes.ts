// V3-OBS-32 環境データ CSV インポート(registry.json: SwitchBot限定ではなく汎用フォー
// マット/汎用列マッピング・重複行を挿入しないappend/diff方式・上限200,000行/16MB)。
// 正本: docs/planning/c7/usecase-driven-design.md §machines-environment-io。
//
// PROTECTED (not in index.ts PUBLIC_ROUTES — session gate applies, actor_id は常に
// セッション principal)。書き込みは既存 FND-18 telemetry bucket infra を再利用する
// (source-routes.ts の bucketize/ingestTelemetryBuckets/projectTelemetryLatest —
// 別実装しない・同じ語彙に合わせる)。CSV 取込は source="csv" を付けて put-if-absent
// する(OQ-LB-02裁定: bucketキーにsource種別を含め複数snapshotを共存させる)ので、期間
// が重なる再投入(同一ファイルの再ドロップ・月次再エクスポート)は自動的に
// skipped_duplicate へ落ち、エラーにも取込停止にもならない(冪等・不変条項③)。
import { Hono } from "hono";
import { TruthStore } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { bucketize } from "./telemetry-merge";
import { CSV_MAX_BYTES, isParseError, parseEnvCsv, type EnvCsvOverride } from "./csv-import";
import { ingestTelemetryBuckets, projectTelemetryLatest } from "./source-routes";

export const envImportRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const ENV_IMPORT_SOURCE = "csv";

// POST /obs/env-import — multipart(file, device_id[, placement_id][, dry_run]
// [, column_mapping]). file+device_id required (400 otherwise). dry_run="true"
// computes would-be counts via put-if-absent EXISTENCE CHECK ONLY (no write —
// safe to preview repeatedly). column_mapping (JSON: {timestamp_column, metrics})
// overrides the SwitchBot auto-preset for non-SwitchBot exports (汎用列マッピング).
// placement_id is echoed only — shelf↔device association is the existing
// /device-bindings flow (source-routes.ts); this route is device-scoped ingest.
envImportRoutes.post("/obs/env-import", async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  const deviceId = form?.get("device_id");
  if (!(file instanceof Blob) || typeof deviceId !== "string" || !deviceId) {
    return c.json({ error: "INVALID_IMPORT", details: ["file and device_id required"] }, 400);
  }
  const placementRaw = form?.get("placement_id");
  const placementId = typeof placementRaw === "string" && placementRaw ? placementRaw : null;
  const dryRun = form?.get("dry_run") === "true";

  let override: EnvCsvOverride | undefined;
  const mappingRaw = form?.get("column_mapping");
  if (typeof mappingRaw === "string" && mappingRaw) {
    try {
      override = JSON.parse(mappingRaw) as EnvCsvOverride;
    } catch {
      return c.json({ error: "INVALID_COLUMN_MAPPING" }, 400);
    }
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Byte-exact check ahead of parseEnvCsv's own re-check: the upload's raw byte
  // length is the authoritative "16MB" (parseEnvCsv re-derives it from the
  // decoded string — kept as defense in depth, not because it can disagree here).
  if (bytes.byteLength > CSV_MAX_BYTES) {
    return c.json({ error: "CSV_TOO_LARGE", max_bytes: CSV_MAX_BYTES, actual_bytes: bytes.byteLength }, 400);
  }
  const csvText = new TextDecoder("utf-8").decode(bytes);

  const parsed = parseEnvCsv(csvText, deviceId, override);
  if (isParseError(parsed)) {
    return c.json({ error: parsed.error, ...(parsed.details ?? {}) }, 400);
  }

  const buckets = bucketize(parsed.rows);
  const validRowCount = buckets.reduce((n, b) => n + b.count, 0);
  // Defensive parity field only — parseEnvCsv already drops non-finite cells, so
  // this is expected to always be 0; kept so the response uses the SAME
  // written/skipped_duplicate/skipped_invalid vocabulary as POST /telemetry.
  const skippedInvalidCells = parsed.rows.length - validRowCount;

  const actorId = c.get("actorId");
  const st = new TruthStore(c.env.TRUTH);
  const { written, skipped_duplicate, invalid } = await ingestTelemetryBuckets(st, actorId, buckets, ENV_IMPORT_SOURCE, {
    dryRun,
  });
  if (invalid.length > 0) return c.json({ error: "INVALID_TELEMETRY", details: invalid }, 400);

  return c.json(
    {
      device_id: deviceId,
      placement_id: placementId,
      dry_run: dryRun,
      csv_rows_read: parsed.csv_rows_read,
      invalid_rows: parsed.invalid_rows,
      written,
      skipped_duplicate,
      skipped_invalid: skippedInvalidCells,
    },
    dryRun ? 200 : 202,
  );
});

// GET /obs/telemetry/latest?device_id=...&metric=... — read-back projection
// (V3-OBS-32 / OQ-LB-02): per logical bucket (device_id, metric, bucket_start_ms)
// picks the source-count-max snapshot across all ingest sources (csv/collector/
// manual) that wrote into it. Always recomputed (不変条項①・no resident index).
envImportRoutes.get("/obs/telemetry/latest", async (c) => {
  const deviceId = c.req.query("device_id");
  if (!deviceId) return c.json({ error: "INVALID_QUERY", details: ["device_id required"] }, 400);
  const metric = c.req.query("metric") || undefined;
  const readings = await projectTelemetryLatest(c.env.TRUTH, deviceId, metric);
  return c.json({ device_id: deviceId, readings });
});
