// V3-OBS-33 w3-plaza(第3波持ち越し回収): Tier B(センサーテレメトリ)の
// 「値変化またはハートビート間隔超過時のみ条件付きINSERT」を検証する。
// source-routes.ts(本艦glob)の shouldInsertTelemetryBucket(純関数)と
// ingestTelemetryBuckets(差分挿入込み)の両方をカバーする。
import { describe, expect, it } from "vitest";
import { TruthStore } from "@ihl/truth";
import { FakeR2Bucket } from "./helpers";
import {
  ingestTelemetryBuckets,
  shouldInsertTelemetryBucket,
  TELEMETRY_HEARTBEAT_MS,
} from "../apps/api/src/source-routes";
import { bucketize, TELEMETRY_BUCKET_MS } from "../apps/api/src/telemetry-merge";

describe("V3-OBS-33 shouldInsertTelemetryBucket(純関数)", () => {
  it("直前バケットが無ければ書く(初回)", () => {
    expect(shouldInsertTelemetryBucket({ bucket_start_ms: 0, mean: 20 }, null)).toBe(true);
  });

  it("値が変化していれば間隔に関わらず書く", () => {
    expect(
      shouldInsertTelemetryBucket(
        { bucket_start_ms: TELEMETRY_BUCKET_MS, mean: 21 },
        { bucket_start_ms: 0, mean: 20 },
      ),
    ).toBe(true);
  });

  it("値が同じでもハートビート間隔を超えていれば書く(生存確認)", () => {
    expect(
      shouldInsertTelemetryBucket(
        { bucket_start_ms: TELEMETRY_HEARTBEAT_MS, mean: 20 },
        { bucket_start_ms: 0, mean: 20 },
      ),
    ).toBe(true);
  });

  it("値が同じかつ間隔内なら書かない(差分挿入)", () => {
    expect(
      shouldInsertTelemetryBucket(
        { bucket_start_ms: TELEMETRY_BUCKET_MS, mean: 20 },
        { bucket_start_ms: 0, mean: 20 },
      ),
    ).toBe(false);
  });
});

describe("V3-OBS-33 ingestTelemetryBuckets 差分挿入(結合)", () => {
  it("同一device+metricで値不変・間隔内の後続バケットは skipped_unchanged になり書かれない(重複=skipped_duplicateとは別事象・2026-07-31 w3fix是正)", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    const b1 = bucketize([{ device_id: "d1", ts_ms: 0, metric: "temp_c", value: 20 }]);
    const first = await ingestTelemetryBuckets(s, "actor-1", b1, "manual");
    expect(first).toEqual({ written: 1, skipped_duplicate: 0, skipped_unchanged: 0, invalid: [] });

    // 次の5分バケット(異なる bucket_start_ms・同じ値20)。
    const b2 = bucketize([{ device_id: "d1", ts_ms: TELEMETRY_BUCKET_MS, metric: "temp_c", value: 20 }]);
    const second = await ingestTelemetryBuckets(s, "actor-1", b2, "manual");
    expect(second).toEqual({ written: 0, skipped_duplicate: 0, skipped_unchanged: 1, invalid: [] });
  });

  it("値が変化した後続バケットは書かれる", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    const b1 = bucketize([{ device_id: "d1", ts_ms: 0, metric: "temp_c", value: 20 }]);
    await ingestTelemetryBuckets(s, "actor-1", b1, "manual");

    const b2 = bucketize([{ device_id: "d1", ts_ms: TELEMETRY_BUCKET_MS, metric: "temp_c", value: 22 }]);
    const second = await ingestTelemetryBuckets(s, "actor-1", b2, "manual");
    expect(second).toEqual({ written: 1, skipped_duplicate: 0, skipped_unchanged: 0, invalid: [] });
  });

  it("値不変でもハートビート間隔を超えたバケットは書かれる", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    const b1 = bucketize([{ device_id: "d1", ts_ms: 0, metric: "temp_c", value: 20 }]);
    await ingestTelemetryBuckets(s, "actor-1", b1, "manual");

    const laterMs = TELEMETRY_HEARTBEAT_MS + TELEMETRY_BUCKET_MS;
    const b2 = bucketize([{ device_id: "d1", ts_ms: laterMs, metric: "temp_c", value: 20 }]);
    const second = await ingestTelemetryBuckets(s, "actor-1", b2, "manual");
    expect(second).toEqual({ written: 1, skipped_duplicate: 0, skipped_unchanged: 0, invalid: [] });
  });
});
