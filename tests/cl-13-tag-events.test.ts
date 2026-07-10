// CL-13: タグ append-only イベント — schemas/frozen/tag-event.schema.json。
// 集約(aggregate)ビューは投影層の派生物で Truth ではない (README 対応表)。
import { describe, expect, it } from "vitest";
import { validateFrozen } from "@ihl/truth";
import app from "../apps/api/src/index";
import { AUTH_HEADERS, loadFixture, makeEnv, makeEnvelope } from "./helpers";

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

describe("CL-13 tag event append-only (HTTP level)", () => {
  it("duplicate tag event id → 409; invalid shape → 400", async () => {
    const env = makeEnv();
    const good = makeEnvelope({
      type: "ihl.obs.tag_event.v1",
      dataschema: DATASCHEMA,
      data: sample,
    });
    const init = {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify(good),
    };
    expect((await app.request("/events", init, env)).status).toBe(201);
    expect((await app.request("/events", init, env)).status).toBe(409);

    const bad = makeEnvelope({
      type: "ihl.obs.tag_event.v1",
      dataschema: DATASCHEMA,
      data: { ...sample, target_type: "planet" },
    });
    const res = await app.request(
      "/events",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(bad) },
      env,
    );
    expect(res.status).toBe(400);
  });
});
