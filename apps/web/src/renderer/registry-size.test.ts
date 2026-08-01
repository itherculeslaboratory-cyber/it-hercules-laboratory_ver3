import { describe, it, expect } from "vitest";
import { registrySize } from "./core/registry";

describe("registrySize — Phase 0時点では誰も登録していない", () => {
  it("registrySize() === 0", () => {
    expect(registrySize()).toBe(0);
  });
});
