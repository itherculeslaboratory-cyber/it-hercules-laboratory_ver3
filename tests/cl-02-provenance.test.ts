// CL-02: Truth provenance メタ (run_id / schema_version / input_hash / value_origin)
// — schemas/frozen/provenance.schema.json が担保先。
import { describe, expect, it } from "vitest";
import { validateEnvelope, validateFrozen } from "@ihl/truth";
import app from "../apps/api/src/index";
import { AUTH_HEADERS, loadFixture, makeEnv, makeEnvelope } from "./helpers";

const sample = loadFixture("cl-shape-samples.json")["cl-02"] as Record<
  string,
  unknown
>;
const DATASCHEMA = "schemas/frozen/provenance.schema.json";

describe("CL-02 provenance meta", () => {
  it("accepts the real ver2 sample", () => {
    expect(validateFrozen("provenance", sample).valid).toBe(true);
  });

  it.each(["run_id", "schema_version", "input_hash", "created_at"])(
    "rejects a record missing required %s",
    (field) => {
      const bad = { ...sample };
      delete bad[field];
      expect(validateFrozen("provenance", bad).valid).toBe(false);
    },
  );

  it("rejects value_origin outside the frozen enum", () => {
    const bad = { ...sample, value_origin: "guessed" };
    expect(validateFrozen("provenance", bad).valid).toBe(false);
  });

  it("rejects unknown extra properties (additionalProperties: false)", () => {
    const bad = { ...sample, freeform_note: "x" };
    expect(validateFrozen("provenance", bad).valid).toBe(false);
  });

  it("validates envelope data against the frozen schema via dataschema", () => {
    const good = makeEnvelope({ dataschema: DATASCHEMA, data: sample });
    expect(validateEnvelope(good).valid).toBe(true);

    const badData = { ...sample };
    delete badData.run_id;
    const bad = makeEnvelope({ dataschema: DATASCHEMA, data: badData });
    expect(validateEnvelope(bad).valid).toBe(false);
  });

  it("rejects an envelope missing its own provenance extension", () => {
    const bad = makeEnvelope();
    delete (bad as Record<string, unknown>).provenance;
    expect(validateEnvelope(bad).valid).toBe(false);
  });

  it("POST /events with broken provenance data → 400", async () => {
    const badData = { ...sample };
    delete badData.run_id;
    const res = await app.request(
      "/events",
      {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify(
          makeEnvelope({ dataschema: DATASCHEMA, data: badData }),
        ),
      },
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });
});
