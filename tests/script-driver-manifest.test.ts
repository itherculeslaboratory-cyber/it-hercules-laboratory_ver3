// V3-FND-20(持ち越し・61代目HQ裁定(c)採用): ScriptManifest MVP契約+危険API拒否ゲート。
// ADR-V3-WASM-01 の Extism/Spin ランタイム本体・真のASTバリデータは本ラン対象外
// (依存追加ゼロ・凍結遵守)。
import { describe, expect, it } from "vitest";
import {
  validateManifestShape,
  scanForDeniedApis,
  auditScript,
  type ScriptManifest,
} from "../apps/api/src/script-driver-manifest";

const VALID_MANIFEST: ScriptManifest = {
  id: "s1",
  version: "1.0.0",
  language: "js-subset",
  allowed_apis: [],
  entrypoint: "main",
};

describe("V3-FND-20 validateManifestShape", () => {
  it("accepts a well-formed manifest", () => {
    expect(validateManifestShape(VALID_MANIFEST)).toEqual({ valid: true, errors: [] });
  });

  it("rejects a manifest missing required fields", () => {
    const result = validateManifestShape({ language: "js-subset" });
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("MANIFEST_MISSING_ID");
  });

  it("rejects any language other than js-subset (全言語相互変換は目標から外す)", () => {
    const result = validateManifestShape({ ...VALID_MANIFEST, language: "python" });
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("MANIFEST_UNSUPPORTED_LANGUAGE");
  });
});

describe("V3-FND-20 scanForDeniedApis (危険API拒否ゲート・実行前静的スキャン)", () => {
  it("denies a script that calls fs without it being whitelisted", () => {
    const denied = scanForDeniedApis("const x = fs.readFileSync('x')", []);
    expect(denied.some((e) => e.message.includes("fs"))).toBe(true);
  });

  it("allows a whitelisted API to pass through", () => {
    const denied = scanForDeniedApis("const x = fetch('https://example.com')", ["fetch"]);
    expect(denied).toEqual([]);
  });

  it("denies eval/Function/child_process/process as dangerous by default", () => {
    expect(scanForDeniedApis("eval('1+1')", []).length).toBeGreaterThan(0);
    expect(scanForDeniedApis("new Function('return 1')", []).length).toBeGreaterThan(0);
    expect(scanForDeniedApis("require('child_process')", []).length).toBeGreaterThan(0);
  });

  it("a script with no dangerous identifiers passes clean", () => {
    expect(scanForDeniedApis("function main() { return 1 + 1; }", [])).toEqual([]);
  });
});

describe("V3-FND-20 auditScript", () => {
  it("returns status:ok and no errors for a clean manifest+source", () => {
    const now = new Date("2026-07-31T00:00:00Z");
    const { entry, errors } = auditScript("run-1", VALID_MANIFEST, "function main() { return 1; }", now);
    expect(entry.status).toBe("ok");
    expect(errors).toEqual([]);
    expect(entry.script_id).toBe("s1");
  });

  it("returns status:denied when the source references a non-whitelisted dangerous API", () => {
    const now = new Date("2026-07-31T00:00:00Z");
    const { entry, errors } = auditScript("run-2", VALID_MANIFEST, "require('fs').writeFileSync('x','y')", now);
    expect(entry.status).toBe("denied");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("returns status:denied when the manifest itself is malformed", () => {
    const now = new Date("2026-07-31T00:00:00Z");
    const { entry } = auditScript("run-3", { ...VALID_MANIFEST, entrypoint: "" }, "function main(){}", now);
    expect(entry.status).toBe("denied");
    expect(entry.script_id).toBe("(invalid-manifest)");
  });
});
