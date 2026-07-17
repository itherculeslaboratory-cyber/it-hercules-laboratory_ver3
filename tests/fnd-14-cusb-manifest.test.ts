// V3-FND-14 — C-USB(Civilization-USB: core/rag/io/compatibility/security)最小単位
// の機械可読定義。checkComponent(dir) が manifest.json の cusb_layer フィールドを
// 検証する(欠落/未知の値を flag)。実コンポーネントの割当は
// docs/architecture/component-swap-checklist.md 参照(差替時の 6 項目レビューは
// 人間ゲート — ここは manifest 構造の機械 GATE のみを検証する)。
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { checkComponent } from "../scripts/lint-components.mjs";

function makeComponent(base: string, name: string, manifest: Record<string, unknown>) {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "run.py"), "# entry\n");
  writeFileSync(join(dir, "tests.py"), "# tests\n");
  writeFileSync(join(dir, "golden.json"), "{}\n");
  writeFileSync(join(dir, "README.md"), "# c\n");
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      id: name,
      entrypoint: "run.py",
      inputs: [],
      outputs: [],
      tests: "tests.py",
      golden: "golden.json",
      ...manifest,
    }),
  );
  return dir;
}

describe("V3-FND-14 checkComponent cusb_layer (C-USB minimal unit definition)", () => {
  it("accepts each of the 5 declared C-USB layers", () => {
    const base = mkdtempSync(join(tmpdir(), "fnd14-"));
    try {
      for (const layer of ["core", "rag", "io", "compatibility", "security"]) {
        const dir = makeComponent(base, `c-${layer}`, { cusb_layer: layer });
        expect(checkComponent(dir)).toEqual([]);
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("flags a missing cusb_layer", () => {
    const base = mkdtempSync(join(tmpdir(), "fnd14-"));
    try {
      const dir = join(base, "no-layer");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "run.py"), "# entry\n");
      writeFileSync(join(dir, "tests.py"), "# tests\n");
      writeFileSync(join(dir, "golden.json"), "{}\n");
      writeFileSync(join(dir, "README.md"), "# c\n");
      writeFileSync(
        join(dir, "manifest.json"),
        JSON.stringify({
          id: "no-layer",
          entrypoint: "run.py",
          inputs: [],
          outputs: [],
          tests: "tests.py",
          golden: "golden.json",
        }),
      );
      expect(checkComponent(dir).some((v) => v.includes('"cusb_layer"'))).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("flags an unknown cusb_layer value", () => {
    const base = mkdtempSync(join(tmpdir(), "fnd14-"));
    try {
      const dir = makeComponent(base, "bad-layer", { cusb_layer: "database" });
      expect(checkComponent(dir).some((v) => v.includes("cusb_layer"))).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("the repo's onboarded components (collector-switchbot, wiki-ingest) declare a valid cusb_layer", () => {
    for (const name of ["collector-switchbot", "wiki-ingest"]) {
      const dir = fileURLToPath(new URL(`../components/${name}`, import.meta.url));
      const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
      expect(["core", "rag", "io", "compatibility", "security"]).toContain(manifest.cusb_layer);
      expect(checkComponent(dir)).toEqual([]);
    }
  });
});
