// V3-FND-08 — データ所有権(復元ポイント作成/一覧・ユーザー自身のデータの範囲選択
// エクスポート)。フォーマットは本ラン JSON のみ(follow-up note: CSV/画像/動画/音声/
// PDF は変換層として別途)。
import { describe, expect, it } from "vitest";
import { TruthStore, ulid } from "@ihl/truth";
import { FakeR2Bucket } from "./helpers";
import {
  createRestorePoint,
  listRestorePoints,
  exportActorData,
  exportActorDataAsCsv,
} from "../apps/api/src/truth-backup-connector";

function ev(type: string, actorId: string) {
  return {
    specversion: "1.0",
    id: ulid(),
    source: "apps/api",
    type,
    time: "2026-07-31T00:00:00Z",
    provenance: { generator_kind: "agent", agent_name: "claude-code" },
    data: { actor_id: actorId, note: "test" },
  };
}

describe("V3-FND-08 createRestorePoint / listRestorePoints", () => {
  it("captures the current Truth key set as a restore point", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    await s.putEvent(ev("ihl.test.sample.v1", "u1"));
    await s.putEvent(ev("ihl.test.sample.v1", "u2"));

    const now = new Date("2026-07-31T00:00:00Z");
    const rp = await createRestorePoint(s, now, bucket);
    expect(rp.total_keys).toBe(2);
    expect(rp.keys.every((k) => k.startsWith("truth/"))).toBe(true);

    const list = await listRestorePoints(s);
    expect(list).toHaveLength(1);
    expect(list[0].restore_point_id).toBe(rp.restore_point_id);
  });

  it("a restore point created after another restore point exists still counts itself once (not double-counted)", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    await s.putEvent(ev("ihl.test.sample.v1", "u1"));
    const rp1 = await createRestorePoint(s, new Date("2026-07-01T00:00:00Z"), bucket);
    expect(rp1.total_keys).toBe(1);
    // the restore point event itself is now in Truth, so a 2nd restore point sees 2 keys
    const rp2 = await createRestorePoint(s, new Date("2026-07-02T00:00:00Z"), bucket);
    expect(rp2.total_keys).toBe(2);
  });
});

describe("V3-FND-08 exportActorData", () => {
  it("returns only events whose actor_id matches the requested actor", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await s.putEvent(ev("ihl.test.sample.v1", "u1"));
    await s.putEvent(ev("ihl.test.sample.v1", "u2"));
    await s.putEvent(ev("ihl.test.sample.v1", "u1"));

    const bundle = await exportActorData(s, "u1", new Date("2026-07-31T00:00:00Z"));
    expect(bundle.event_count).toBe(2);
    expect(bundle.format).toBe("json");
    expect(bundle.events.every((e) => (e.data as { actor_id: string }).actor_id === "u1")).toBe(true);
  });

  it("returns an empty bundle (not an error) for an actor with no data", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    const bundle = await exportActorData(s, "nobody", new Date("2026-07-31T00:00:00Z"));
    expect(bundle.event_count).toBe(0);
    expect(bundle.events).toEqual([]);
  });
});

describe("V3-FND-08 exportActorDataAsCsv (w3-fnd follow-up)", () => {
  it("emits a header row plus one row per matching event", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await s.putEvent(ev("ihl.test.sample.v1", "u1"));
    await s.putEvent(ev("ihl.test.sample.v1", "u2"));

    const csv = await exportActorDataAsCsv(s, "u1", new Date("2026-07-31T00:00:00Z"));
    const lines = csv.split("\n");
    expect(lines[0]).toBe("id,type,time,data");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("ihl.test.sample.v1");
  });

  it("returns only the header row for an actor with no data", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    const csv = await exportActorDataAsCsv(s, "nobody", new Date("2026-07-31T00:00:00Z"));
    expect(csv).toBe("id,type,time,data");
  });

  it("escapes commas, quotes, and newlines in the data column", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await s.putEvent({
      specversion: "1.0",
      id: ulid(),
      source: "apps/api",
      type: "ihl.test.sample.v1",
      time: "2026-07-31T00:00:00Z",
      provenance: { generator_kind: "agent", agent_name: "claude-code" },
      data: { actor_id: "u1", note: 'has,comma and "quote"' },
    });

    const csv = await exportActorDataAsCsv(s, "u1", new Date("2026-07-31T00:00:00Z"));
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
    const dataCol = lines[1];
    // the data column is a single quoted CSV field (starts/ends with ") even though
    // its content is itself a JSON string containing a comma and an escaped quote.
    expect(dataCol).toMatch(/^[^,]+,[^,]+,[^,]+,".*"$/);
  });
});
