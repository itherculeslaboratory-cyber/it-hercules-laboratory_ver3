// CL-06: 個体キー individual_id — schemas/frozen/individual-key.schema.json。
import { describe, expect, it } from "vitest";
import { validateFrozen } from "@ihl/truth";
import { loadFixture } from "./helpers";

const sample = loadFixture("cl-shape-samples.json")["cl-06"] as Record<
  string,
  unknown
>;

describe("CL-06 individual key", () => {
  it("accepts the real ver2 sample", () => {
    expect(validateFrozen("individual-key", sample).valid).toBe(true);
  });

  it.each(["individual_id", "schema_version", "run_id", "created_at"])(
    "rejects a record missing required %s",
    (field) => {
      const bad = { ...sample };
      delete bad[field];
      expect(validateFrozen("individual-key", bad).valid).toBe(false);
    },
  );

  it("rejects schema_version below 1", () => {
    const bad = { ...sample, schema_version: 0 };
    expect(validateFrozen("individual-key", bad).valid).toBe(false);
  });

  it("rejects a non-string individual_id", () => {
    const bad = { ...sample, individual_id: 12345 };
    expect(validateFrozen("individual-key", bad).valid).toBe(false);
  });

  it("rejects unknown extra properties (key granularity is frozen)", () => {
    const bad = { ...sample, nickname: "Rex" };
    expect(validateFrozen("individual-key", bad).valid).toBe(false);
  });
});
