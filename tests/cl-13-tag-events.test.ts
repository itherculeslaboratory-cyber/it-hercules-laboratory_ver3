// CL-13: タグ append-only イベント — schemas/frozen/tag-event.schema.json。
// 集約(aggregate)ビューは投影層の派生物で Truth ではない (README 対応表)。
import { describe, expect, it } from "vitest";
import { TruthStore, validateFrozen } from "@ihl/truth";
import { FakeR2Bucket, loadFixture, makeEnvelope } from "./helpers";

const sample = loadFixture("cl-shape-samples.json")["cl-13"] as Record<
  string,
  unknown
>;
const DATASCHEMA = "schemas/frozen/tag-event.schema.json";

describe("CL-13 tag event shape", () => {
  it("accepts the real ver2 tag_event sample", () => {
    expect(validateFrozen("tag-event", sample).valid).toBe(true);
  });

  it("rejects an unknown target_type", () => {
    const bad = { ...sample, target_type: "planet" };
    expect(validateFrozen("tag-event", bad).valid).toBe(false);
  });

  it("rejects confidence outside [0,1]", () => {
    const bad = { ...sample, confidence: 1.5 };
    expect(validateFrozen("tag-event", bad).valid).toBe(false);
  });

  it.each(["tag_event_id", "tag", "tag_type", "action", "source_type"])(
    "rejects an event missing required %s",
    (field) => {
      const bad = { ...sample };
      delete bad[field];
      expect(validateFrozen("tag-event", bad).valid).toBe(false);
    },
  );

  it("rejects unknown extra properties", () => {
    const bad = { ...sample, aggregate_count: 3 };
    expect(validateFrozen("tag-event", bad).valid).toBe(false);
  });
});

// T-71: ihl.obs.tag_event.v1 は typed route(POST /api/v1/tags, tag-routes.ts)を持つ
// ため、汎用 POST /events は allowlist 対象外(events-allowlist-exploit.test.ts で
// 403 を確認)。append-only/frozen 形状の検算そのものは Truth 層(TruthStore.putEvent)
// が担う場所なので、ここは store level で直接検算する(HTTP 層のルーティング可否は別テスト)。
describe("CL-13 tag event append-only (Truth store level)", () => {
  it("duplicate tag event id → conflict; invalid shape → invalid", async () => {
    const store = new TruthStore(new FakeR2Bucket());
    const good = makeEnvelope({
      type: "ihl.obs.tag_event.v1",
      dataschema: DATASCHEMA,
      data: sample,
    });
    expect((await store.putEvent(good)).status).toBe("inserted");
    expect((await store.putEvent(good)).status).toBe("conflict");

    const bad = makeEnvelope({
      type: "ihl.obs.tag_event.v1",
      dataschema: DATASCHEMA,
      data: { ...sample, target_type: "planet" },
    });
    expect((await store.putEvent(bad)).status).toBe("invalid");
  });
});
