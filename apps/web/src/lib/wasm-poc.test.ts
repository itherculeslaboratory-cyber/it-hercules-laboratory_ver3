import { describe, it, expect } from "vitest";
import { runWasmAddPoc } from "./wasm-poc";

// V3-FND-19: actually compiles + instantiates the hand-written WASM bytes via the
// standard WebAssembly API (no build tool, no npm dependency) and runs it.
describe("runWasmAddPoc (V3-FND-19 WASM実行PoC)", () => {
  it("compiles and executes a real WebAssembly module, returning the correct sum", async () => {
    const result = await runWasmAddPoc(2, 3);
    expect(result.sum).toBe(5);
    expect(result.ranOnStandardWebAssemblyApi).toBe(true);
  });

  it("handles negative numbers via i32 semantics", async () => {
    const result = await runWasmAddPoc(-7, 3);
    expect(result.sum).toBe(-4);
  });
});
