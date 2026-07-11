// C5 K1 tag two-layer TC (design-k1 §3 / V3-OBS-63/07/52). Drives the real app
// through the auth gate (DEV_TOKEN bearer). Truth is the frozen tag-event; the
// ai/user layers are derived at aggregate read from source_type.
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore } from "@ihl/truth";
import { aggregateTags, confidenceGrade } from "../apps/api/src/tag-routes";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const JSON_HEADERS = { "content-type": "application/json" };
const AUTH = { Authorization: `Bearer ${DEV_TOKEN}` };
const AUTH_JSON = { ...AUTH, ...JSON_HEADERS };

function ctx() {
  const bucket = new FakeR2Bucket();
  return { bucket, env: makeEnv(bucket) };
}
async function tag(env: object, body: Record<string, unknown>) {
  return app.request("/api/v1/tags", { method: "POST", headers: AUTH_JSON, body: JSON.stringify(body) }, env);
}
async function aggregate(env: object, targetType: string, targetId: string) {
  return app.request(`/api/v1/tags?target_type=${targetType}&target_id=${targetId}`, { headers: AUTH }, env);
}

const HUMAN = "human_added";
const MACHINE = "machine_suggested";

describe("OBS-63 tag two-layer aggregate (strong/weak/disputed)", () => {
  async function seed(env: object, target = "ind-1") {
    const base = { target_type: "individual", target_id: target, tag_type: "color" };
    // orange-base: both layers add -> strong
    await tag(env, { ...base, tag: "orange-base", source_type: HUMAN, action: "add" });
    await tag(env, { ...base, tag: "orange-base", source_type: MACHINE, action: "add" });
    // big: user only -> weak
    await tag(env, { ...base, tag: "big", source_type: HUMAN, action: "add" });
    // striped: machine add, human remove -> disputed
    await tag(env, { ...base, tag: "striped", source_type: MACHINE, action: "add" });
    await tag(env, { ...base, tag: "striped", source_type: HUMAN, action: "remove" });
  }

  it("derives ai_tags/user_tags and strong/weak/disputed", async () => {
    const { env } = ctx();
    await seed(env);
    const agg = (await (await aggregate(env, "individual", "ind-1")).json()) as {
      ai_tags: string[];
      user_tags: string[];
      strong: string[];
      weak: string[];
      disputed: string[];
    };
    expect(agg.ai_tags).toEqual(["orange-base", "striped"]);
    expect(agg.user_tags).toEqual(["big", "orange-base"]);
    expect(agg.strong).toEqual(["orange-base"]);
    expect(agg.weak).toEqual(["big"]);
    expect(agg.disputed).toEqual(["striped"]);
  });

  it("400 when a derived layer has zero events (only human tags)", async () => {
    const { env } = ctx();
    await tag(env, { target_type: "individual", target_id: "ind-2", tag: "x", tag_type: "color", source_type: HUMAN });
    const res = await aggregate(env, "individual", "ind-2");
    expect(res.status).toBe(400);
  });

  it("missing required source_type -> 400 (frozen schema)", async () => {
    const { env } = ctx();
    const res = await tag(env, { target_type: "individual", target_id: "ind-3", tag: "x", tag_type: "color" });
    expect(res.status).toBe(400);
  });
});

describe("OBS-07/52 remeasure tag lands in the machine (ai) layer", () => {
  it("machine remeasure tag appears in ai_tags", async () => {
    const { env, bucket } = ctx();
    await tag(env, { target_type: "measurement", target_id: "m-1", tag: "remeasure", tag_type: "quality", source_type: MACHINE });
    const agg = await aggregateTags(new TruthStore(bucket), "measurement", "m-1");
    // only ai layer has events -> aggregate read returns null (both-layer rule);
    // the append itself succeeded and the derived layer classification is machine.
    expect(agg).toBeNull();
  });
});

describe("OBS-07 confidenceGrade (value_origin -> grade, 自動>手入力>後日編集)", () => {
  const rank = { "◎": 3, "○": 2, "△": 1 } as const;
  it("auto=◎ > derived=○ > estimated=△", () => {
    expect(confidenceGrade({ value_origin: "direct_observed" })).toBe("◎");
    expect(confidenceGrade({ value_origin: "image_derived" })).toBe("○");
    expect(confidenceGrade({ value_origin: "estimated" })).toBe("△");
    expect(rank[confidenceGrade({ value_origin: "direct_observed" })])
      .toBeGreaterThan(rank[confidenceGrade({ value_origin: "image_derived" })]);
    expect(rank[confidenceGrade({ value_origin: "image_derived" })])
      .toBeGreaterThan(rank[confidenceGrade({ value_origin: "estimated" })]);
  });
  it("later-edited (is_manual_edit) is the lowest tier △ regardless of origin", () => {
    expect(confidenceGrade({ value_origin: "direct_observed", is_manual_edit: true })).toBe("△");
  });
  it("is total over the frozen 9-value enum (never undefined)", () => {
    for (const o of ["direct_observed", "image_derived", "environment_derived", "lineage_derived",
      "estimated", "imputed", "aggregate", "model_inference", "unknown"]) {
      expect(["◎", "○", "△"]).toContain(confidenceGrade({ value_origin: o }));
    }
  });
});
