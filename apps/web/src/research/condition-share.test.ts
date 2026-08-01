import { describe, it, expect } from "vitest";
import {
  buildSavedCondition,
  conditionToJson,
  encodeConditionForUrl,
  decodeConditionFromUrl,
} from "./condition-share";

describe("buildSavedCondition (design §4-3 再現性100%)", () => {
  it("manifest generation番号を必ず含む", () => {
    const saved = buildSavedCondition({ conditions: [] }, 7, "2026-08-01T00:00:00+09:00");
    expect(saved.manifest_generation).toBe(7);
    expect(saved.saved_at).toBe("2026-08-01T00:00:00+09:00");
  });

  it("JSON文字列化できる", () => {
    const saved = buildSavedCondition({ conditions: [{ column: "type", operator: "=", value: "x" }] }, 1, "t");
    const json = conditionToJson(saved);
    expect(JSON.parse(json)).toEqual(saved);
  });
});

describe("encodeConditionForUrl / decodeConditionFromUrl", () => {
  it("往復(encode→decode)で元のオブジェクトに戻る", () => {
    const saved = buildSavedCondition(
      { conditions: [{ column: "subject", operator: "LIKE", value: "%golden%" }], limit: 100 },
      2,
      "2026-08-01T00:00:00+09:00",
    );
    const encoded = encodeConditionForUrl(saved);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
    expect(decodeConditionFromUrl(encoded)).toEqual(saved);
  });

  it("日本語を含む値でも往復できる", () => {
    const saved = buildSavedCondition({ conditions: [{ column: "subject", operator: "=", value: "個体1" }] }, 1, "t");
    const encoded = encodeConditionForUrl(saved);
    expect(decodeConditionFromUrl(encoded)).toEqual(saved);
  });
});
