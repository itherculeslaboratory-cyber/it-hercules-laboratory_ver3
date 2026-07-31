// V3-FND-08 — データ所有権(復元ポイント作成/一覧・ユーザー自身のデータの範囲選択
// エクスポート)。フォーマットは本ラン JSON のみ(follow-up note: CSV/画像/動画/音声/
// PDF は変換層として別途)。
import { describe, expect, it } from "vitest";
import { TruthStore, ulid } from "@ihl/truth";
import { FakeR2Bucket } from "./helpers";
import {
  createRestorePoint,
  createRestorePointWithLimit,
  listRestorePoints,
  exportActorData,
  exportActorDataAsCsv,
  applyRestorePoint,
  buildActorExportArchive,
  RestorePointNotFoundError,
  RestorePointLimitExceededError,
  RestoreApplyLimitExceededError,
  MAX_RESTORE_POINTS,
  MAX_RESTORE_APPLICATIONS_PER_ACTOR,
} from "../apps/api/src/truth-backup-connector";

/** gzip(tar) を展開し、USTAR ヘッダを読んで {path: text} の Map を返す(テスト用の最小 tar リーダ)。 */
async function gunzipTar(bytes: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const tarBytes = new Uint8Array(await new Response(stream).arrayBuffer());
  const out = new Map<string, Uint8Array>();
  let offset = 0;
  const dec = new TextDecoder();
  while (offset + 512 <= tarBytes.byteLength) {
    const header = tarBytes.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break; // EOF block
    const name = dec.decode(header.subarray(0, 100)).replace(/\0.*$/s, "");
    const sizeOctal = dec.decode(header.subarray(124, 136)).replace(/\0.*$/s, "").trim();
    const size = parseInt(sizeOctal, 8) || 0;
    offset += 512;
    out.set(name, tarBytes.subarray(offset, offset + size));
    offset += size + (size % 512 === 0 ? 0 : 512 - (size % 512));
  }
  return out;
}

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

describe("V3-FND-08 論点1(w-fnd2): exportActorData 範囲選択(range)", () => {
  it("filters by type prefix", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await s.putEvent(ev("ihl.obs.capture.v1", "u1"));
    await s.putEvent(ev("ihl.mkt.listing.v1", "u1"));

    const bundle = await exportActorData(s, "u1", new Date("2026-07-31T00:00:00Z"), { types: ["ihl.obs."] });
    expect(bundle.event_count).toBe(1);
    expect(bundle.events[0].type).toBe("ihl.obs.capture.v1");
  });

  it("filters by time range (inclusive)", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await s.putEvent({ ...ev("ihl.test.sample.v1", "u1"), time: "2026-01-01T00:00:00Z" });
    await s.putEvent({ ...ev("ihl.test.sample.v1", "u1"), time: "2026-06-01T00:00:00Z" });
    await s.putEvent({ ...ev("ihl.test.sample.v1", "u1"), time: "2026-12-01T00:00:00Z" });

    const bundle = await exportActorData(s, "u1", new Date("2026-07-31T00:00:00Z"), {
      from: "2026-02-01T00:00:00Z",
      to: "2026-11-01T00:00:00Z",
    });
    expect(bundle.event_count).toBe(1);
    expect(bundle.events[0].time).toBe("2026-06-01T00:00:00Z");
  });
});

describe("V3-FND-08 論点1(w-fnd2): buildActorExportArchive(.tar.gz 同梱)", () => {
  it("packs bundle.json + bundle.csv + print.html into a valid gzip(tar)", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    await s.putEvent(ev("ihl.test.sample.v1", "u1"));

    const archive = await buildActorExportArchive(s, bucket, "u1", new Date("2026-07-31T00:00:00Z"), {});
    expect(archive.event_count).toBe(1);
    expect(archive.blob_count).toBe(0);

    const files = await gunzipTar(archive.bytes);
    expect(files.has("bundle.json")).toBe(true);
    expect(files.has("bundle.csv")).toBe(true);
    expect(files.has("print.html")).toBe(true);

    const dec = new TextDecoder();
    const bundleJson = JSON.parse(dec.decode(files.get("bundle.json")));
    expect(bundleJson.event_count).toBe(1);
    expect(dec.decode(files.get("bundle.csv"))).toContain("ihl.test.sample.v1");
    expect(dec.decode(files.get("print.html"))).toContain("印刷");
  });

  it("bundles referenced blobs under blobs/ without converting their format", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    await bucket.put("media/photo/p1", new TextEncoder().encode("fake-jpeg-bytes"), {
      httpMetadata: { contentType: "image/jpeg" },
    });
    await s.putEvent({
      specversion: "1.0",
      id: ulid(),
      source: "apps/api",
      type: "ihl.obs.photo.v1",
      time: "2026-07-31T00:00:00Z",
      provenance: { generator_kind: "agent", agent_name: "claude-code" },
      data: { actor_id: "u1", photo_id: "p1" },
    });

    const archive = await buildActorExportArchive(s, bucket, "u1", new Date("2026-07-31T00:00:00Z"), {});
    expect(archive.blob_count).toBe(1);
    const files = await gunzipTar(archive.bytes);
    const blob = files.get("blobs/media_photo_p1");
    expect(blob).toBeDefined();
    expect(new TextDecoder().decode(blob)).toBe("fake-jpeg-bytes");
  });
});

describe("V3-FND-08 論点2(w-fnd2): applyRestorePoint(復元=過去内容の再投稿)", () => {
  it("reposts the actor's own events as new events with new ids (not overwriting)", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    await s.putEvent(ev("ihl.test.sample.v1", "u1"));
    await s.putEvent(ev("ihl.test.sample.v1", "u2"));
    const rp = await createRestorePoint(s, new Date("2026-01-01T00:00:00Z"), bucket);

    const before = await exportActorData(s, "u1", new Date("2026-01-01T00:00:00Z"));
    expect(before.event_count).toBe(1);

    const result = await applyRestorePoint(s, rp.restore_point_id, "u1", new Date("2026-02-01T00:00:00Z"));
    expect(result.applied_event_count).toBe(1);

    const after = await exportActorData(s, "u1", new Date("2026-02-01T00:00:00Z"));
    // original event + 1 reposted event + 1 restore-applied audit event (also
    // carries actor_id, so it legitimately shows up in the actor's own export) = 3
    expect(after.event_count).toBe(3);
    expect(after.events.some((e) => String(e.time).startsWith("2026-02-01T00:00:00"))).toBe(true);
    // u2's data must not be touched by u1's restore
    const u2 = await exportActorData(s, "u2", new Date("2026-02-01T00:00:00Z"));
    expect(u2.event_count).toBe(1);
  });

  it("throws RestorePointNotFoundError for an unknown restore point id", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await expect(applyRestorePoint(s, "nope", "u1", new Date())).rejects.toBeInstanceOf(RestorePointNotFoundError);
  });

  it("enforces the per-actor restore-application limit", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    await s.putEvent(ev("ihl.test.sample.v1", "u1"));
    const rp = await createRestorePoint(s, new Date("2026-01-01T00:00:00Z"), bucket);

    for (let i = 0; i < MAX_RESTORE_APPLICATIONS_PER_ACTOR; i++) {
      await applyRestorePoint(s, rp.restore_point_id, "u1", new Date(`2026-0${i + 2}-01T00:00:00Z`));
    }
    await expect(
      applyRestorePoint(s, rp.restore_point_id, "u1", new Date("2026-12-01T00:00:00Z")),
    ).rejects.toBeInstanceOf(RestoreApplyLimitExceededError);
  });
});

describe("V3-FND-08: createRestorePointWithLimit(復元ポイント数の上限)", () => {
  it("rejects creating a new restore point once the cap is reached", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    for (let i = 0; i < MAX_RESTORE_POINTS; i++) {
      await createRestorePointWithLimit(s, new Date(`2026-0${(i % 9) + 1}-01T00:00:00Z`), bucket);
    }
    await expect(createRestorePointWithLimit(s, new Date("2026-12-01T00:00:00Z"), bucket)).rejects.toBeInstanceOf(
      RestorePointLimitExceededError,
    );
  });
});
