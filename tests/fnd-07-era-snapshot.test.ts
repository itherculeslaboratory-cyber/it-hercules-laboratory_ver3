// V3-FND-07 — Era Snapshot(四半期等の文明全体スナップショット)の append/一覧/復元。
import { describe, expect, it } from "vitest";
import { TruthStore } from "@ihl/truth";
import { FakeR2Bucket } from "./helpers";
import { createEraSnapshot, listEraSnapshots, restoreEraSnapshot } from "../apps/api/src/batch-era-snapshot";

describe("V3-FND-07 createEraSnapshot / listEraSnapshots / restoreEraSnapshot", () => {
  it("creates an Era Snapshot and lists it back with the same config", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    const now = new Date("2026-07-31T00:00:00Z");
    const config = { templates: ["t1"], species: ["hercules"] };
    const rec = await createEraSnapshot(s, now, config);

    expect(rec.era_snapshot_id).toBeTruthy();
    expect(rec.created_at).toBe(now.toISOString());

    const list = await listEraSnapshots(s);
    expect(list).toHaveLength(1);
    expect(list[0].config).toEqual(config);
  });

  it("lists multiple snapshots in ascending created_at order (functions as a timeline)", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    const rec1 = await createEraSnapshot(s, new Date("2026-01-01T00:00:00Z"), { gen: 1 });
    const rec2 = await createEraSnapshot(s, new Date("2026-04-01T00:00:00Z"), { gen: 2 });

    const list = await listEraSnapshots(s);
    expect(list.map((r) => r.era_snapshot_id)).toEqual([rec1.era_snapshot_id, rec2.era_snapshot_id]);
  });

  it("restoreEraSnapshot returns the config for an existing snapshot id (rollback)", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    const config = { logic_config: { v: 1 } };
    const rec = await createEraSnapshot(s, new Date("2026-07-31T00:00:00Z"), config);

    const restored = await restoreEraSnapshot(s, rec.era_snapshot_id);
    expect(restored).toEqual(config);
  });

  it("restoreEraSnapshot returns null for an unknown id (caller maps to 404)", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    expect(await restoreEraSnapshot(s, "01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBeNull();
  });

  it("stored era snapshots are immutable — creating never overwrites a past snapshot", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    const rec1 = await createEraSnapshot(s, new Date("2026-01-01T00:00:00Z"), { gen: 1 });
    await createEraSnapshot(s, new Date("2026-02-01T00:00:00Z"), { gen: 2 });
    // gen:1 snapshot is still restorable unchanged after a later snapshot was made
    expect(await restoreEraSnapshot(s, rec1.era_snapshot_id)).toEqual({ gen: 1 });
  });
});
