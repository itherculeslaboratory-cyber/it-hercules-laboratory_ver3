import { describe, it, expect } from "vitest";
import { ApiError, mapError } from "./error-messages";

describe("error-messages (V3-UIX-03)", () => {
  it("maps 409 to a Japanese conflict sentence, not a raw status", () => {
    const msg = mapError("409");
    expect(msg).toContain("競合");
    expect(msg).not.toMatch(/api\s*409/i);
    expect(msg).not.toMatch(/\b409\b/); // no bare status number leaks
  });

  it("maps auth/permission codes to distinct Japanese copy", () => {
    expect(mapError("401")).toContain("ログイン");
    expect(mapError("403")).toContain("権限");
    expect(mapError(404)).toContain("見つかり"); // accepts numeric code too
  });

  it("falls back to generic copy for an unknown code (never exposes it raw)", () => {
    const msg = mapError("418");
    expect(msg).toBe(mapError("some-nonsense"));
    expect(msg).not.toContain("418");
    expect(msg).not.toContain("api");
    expect(msg.length).toBeGreaterThan(0);
  });

  it("ApiError carries the code and keeps the raw string out of the mapped copy", () => {
    const e = new ApiError(409);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("409");
    expect(e.message).toBe("api 409"); // diagnostic only
    // The UI path (code -> mapError) must not surface that diagnostic string.
    expect(mapError(e.code)).not.toContain("api 409");
  });
});
