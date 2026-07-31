import { describe, it, expect } from "vitest";
import { unwrapEnvelope } from "./api";

describe("unwrapEnvelope (FND-22 S2)", () => {
  it("strips the envelope shape, returning only data", () => {
    const wrapped = { data: { hello: "world" }, meta: { requestId: "abc", timestamp: "2026-08-01T00:00:00Z" } };
    expect(unwrapEnvelope(wrapped)).toEqual({ hello: "world" });
  });

  it("does not unwrap a bare {data:...} with no meta (pre-envelope response)", () => {
    const bare = { data: { hello: "world" } };
    expect(unwrapEnvelope(bare)).toBe(bare);
  });

  it("does not unwrap when meta.requestId is not a string", () => {
    const malformed = { data: { hello: "world" }, meta: { requestId: 123, timestamp: "2026-08-01T00:00:00Z" } };
    expect(unwrapEnvelope(malformed)).toBe(malformed);
  });
});
