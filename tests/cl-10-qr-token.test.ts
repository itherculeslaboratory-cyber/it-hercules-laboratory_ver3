// CL-10: 個体/設置場所 QR トークン — schemas/frozen/qr-token.schema.json。
import { describe, expect, it } from "vitest";
import { validateFrozen } from "@ihl/truth";
import { loadFixture } from "./helpers";

const sample = loadFixture("cl-shape-samples.json")["cl-10"] as Record<
  string,
  unknown
>;

describe("CL-10 qr token", () => {
  it("accepts the real ver2 env_qr_token_v1 record", () => {
    expect(validateFrozen("qr-token", sample).valid).toBe(true);
  });

  it("rejects a token with non URL-safe characters", () => {
    const bad = { ...sample, token: "!!!not/url+safe!!!aaaa" };
    expect(validateFrozen("qr-token", bad).valid).toBe(false);
  });

  it("rejects a token over 200 chars (resolve_qr_token limit)", () => {
    const bad = { ...sample, token: "a".repeat(201) };
    expect(validateFrozen("qr-token", bad).valid).toBe(false);
  });

  it("rejects a token shorter than 20 chars", () => {
    const bad = { ...sample, token: "short" };
    expect(validateFrozen("qr-token", bad).valid).toBe(false);
  });

  it("rejects a wrong schema const", () => {
    const bad = { ...sample, schema: "env_qr_token_v2" };
    expect(validateFrozen("qr-token", bad).valid).toBe(false);
  });

  it.each(["placement_id", "actor_id", "created_at", "expires_at"])(
    "rejects a record missing required %s",
    (field) => {
      const bad = { ...sample };
      delete bad[field];
      expect(validateFrozen("qr-token", bad).valid).toBe(false);
    },
  );
});
