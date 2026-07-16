// V3-OBS-32 CSV import — 汎用列マッピング CSV パーサ(PURE — no IO/Truth/Date.now).
// SwitchBot 標準エクスポート形式(Date,Temperature_Celsius(℃),Relative_Humidity(%),
// DPT(℃),VPD(kPa),Abs Humidity(g/m³)[,Light_Value])はプリセットとして自動認識し、
// それ以外は呼び出し側が column_mapping(timestamp_column + metrics)を渡す汎用経路。
// 出力は telemetry-merge.ts の RawTelemetryRow[]（1行1指標）— 既存 bucketize() を
// そのまま再利用できる形に正規化するのがこのモジュールの唯一の役目。
//
// 上限(V3-OBS-32 registry.json: "上限は200,000行/16MB"): 呼び出し側が超過ファイルを
// 弾く防御。自動チャンク分割(usecase-driven-design §machines-environment-io 手順8)は
// UI/呼び出し側の責務 — put-if-absent 冪等のため同じ CSV を複数回・分割して投げても
// 安全(このモジュールは1呼び出し=1上限内チェックのみ担当)。
import type { RawTelemetryRow } from "./telemetry-merge";

export const CSV_MAX_BYTES = 16 * 1024 * 1024; // 16MB (V3-OBS-32)
export const CSV_MAX_ROWS = 200_000; // data rows, header excluded (V3-OBS-32)

// SwitchBot 標準エクスポートの列名 → 計測種。実データ実例:
// tests/fixtures/csv-import-golden/{hub3-7e,mat-center-temp-11l}.csv
export const SWITCHBOT_TIMESTAMP_HEADER = "Date";
export const SWITCHBOT_METRIC_HEADERS: Record<string, string> = {
  "Temperature_Celsius(℃)": "temperature",
  "Relative_Humidity(%)": "humidity",
  "DPT(℃)": "dew_point",
  "VPD(kPa)": "vpd",
  "Abs Humidity(g/m³)": "abs_humidity",
  Light_Value: "light",
};

export interface EnvCsvOverride {
  timestamp_column?: string;
  metrics?: Record<string, string>; // CSV header -> metric name
}

export interface EnvCsvParseError {
  error: "CSV_TOO_LARGE" | "CSV_TOO_MANY_ROWS" | "UNRESOLVED_COLUMN_MAPPING" | "EMPTY_CSV";
  details?: Record<string, unknown>;
}

export interface EnvCsvParseResult {
  rows: RawTelemetryRow[];
  csv_rows_read: number;
  invalid_rows: number;
  metrics: string[];
}

export function isParseError(x: EnvCsvParseResult | EnvCsvParseError): x is EnvCsvParseError {
  return "error" in x;
}

// ponytail: minimal RFC4180 (quoted fields, "" escape). Real SwitchBot exports are
// plain unquoted numeric CSV — this only guards a hand-edited/relabelled column
// containing a comma from silently shifting every downstream cell.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// "YYYY-MM-DD HH:mm[:ss]" (SwitchBot export format) or ISO "YYYY-MM-DDTHH:mm[:ss]".
const TS_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

// ponytail: naive UTC interpretation — no per-device timezone metadata in scope
// (fixture README notes the source wall-clock is UTC+9). Upgrade path: accept an
// explicit tz_offset_minutes in EnvCsvOverride if a real deployment needs it; the
// bucket dedup key is timestamp-based so getting the offset wrong only shifts
// which 5-min bucket a reading lands in, it never double-counts or drops data.
function parseTimestamp(raw: string): number | null {
  const m = TS_RE.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), s ? Number(s) : 0);
  return Number.isFinite(ms) ? ms : null;
}

function resolveColumnMapping(
  header: string[],
  override?: EnvCsvOverride,
): { timestampIdx: number; metricCols: { idx: number; metric: string }[] } | null {
  const useOverride = !!(override && (override.timestamp_column || override.metrics));
  const tsCol = useOverride ? (override!.timestamp_column ?? SWITCHBOT_TIMESTAMP_HEADER) : SWITCHBOT_TIMESTAMP_HEADER;
  const timestampIdx = header.indexOf(tsCol);
  if (timestampIdx < 0) return null;

  const metricMap = useOverride ? (override!.metrics ?? SWITCHBOT_METRIC_HEADERS) : SWITCHBOT_METRIC_HEADERS;
  const metricCols = header
    .map((h, idx) => ({ idx, metric: metricMap[h] }))
    .filter((x): x is { idx: number; metric: string } => typeof x.metric === "string");
  if (metricCols.length === 0) return null;
  return { timestampIdx, metricCols };
}

/**
 * Parse a generic-mapping environment CSV into flat RawTelemetryRow[] (one row
 * per device/metric/value/ts_ms cell — same shape the existing bucketize() from
 * telemetry-merge.ts already consumes). device_id is NOT read from the CSV (the
 * golden fixtures document this: file→device assignment is a caller decision,
 * not a CSV column) — every row is stamped with the caller-supplied deviceId.
 */
export function parseEnvCsv(
  csvText: string,
  deviceId: string,
  override?: EnvCsvOverride,
): EnvCsvParseResult | EnvCsvParseError {
  const byteLength = new TextEncoder().encode(csvText).byteLength;
  if (byteLength > CSV_MAX_BYTES) {
    return { error: "CSV_TOO_LARGE", details: { max_bytes: CSV_MAX_BYTES, actual_bytes: byteLength } };
  }

  const lines = csvText.split(/\r\n|\r|\n/).filter((l, i, arr) => !(i === arr.length - 1 && l === ""));
  if (lines.length < 1) return { error: "EMPTY_CSV" };

  const header = splitCsvLine(lines[0]);
  const dataLines = lines.slice(1).filter((l) => l.length > 0);
  if (dataLines.length > CSV_MAX_ROWS) {
    return { error: "CSV_TOO_MANY_ROWS", details: { max_rows: CSV_MAX_ROWS, actual_rows: dataLines.length } };
  }

  const mapping = resolveColumnMapping(header, override);
  if (!mapping) return { error: "UNRESOLVED_COLUMN_MAPPING", details: { header } };

  const rows: RawTelemetryRow[] = [];
  let invalidRows = 0;
  for (const line of dataLines) {
    const cells = splitCsvLine(line);
    if (cells.length !== header.length) {
      invalidRows += 1;
      continue;
    }
    const tsMs = parseTimestamp(cells[mapping.timestampIdx]);
    if (tsMs === null) {
      invalidRows += 1;
      continue;
    }
    let anyValid = false;
    for (const { idx, metric } of mapping.metricCols) {
      const raw = cells[idx].trim();
      const value = Number(raw);
      if (raw !== "" && Number.isFinite(value)) {
        rows.push({ device_id: deviceId, ts_ms: tsMs, metric, value });
        anyValid = true;
      }
    }
    if (!anyValid) invalidRows += 1; // timestamp OK but no usable metric value on this row
  }

  return { rows, csv_rows_read: dataLines.length, invalid_rows: invalidRows, metrics: mapping.metricCols.map((m) => m.metric) };
}
