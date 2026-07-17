import { describe, it, expect } from "vitest";
import { pickLocale } from "./viewer-locale";

describe("pickLocale — I18-01/I18-03 viewer locale extraction", () => {
  it("returns the body's locale when present", () => {
    expect(pickLocale({ locale: "en", theme_pack_id: "minimal-light" })).toBe("en");
  });
  it("falls back to ja for a missing/blank/malformed body", () => {
    expect(pickLocale({})).toBe("ja");
    expect(pickLocale({ locale: "" })).toBe("ja");
    expect(pickLocale({ locale: 42 })).toBe("ja");
    expect(pickLocale(null)).toBe("ja");
    expect(pickLocale(undefined)).toBe("ja");
  });
});
