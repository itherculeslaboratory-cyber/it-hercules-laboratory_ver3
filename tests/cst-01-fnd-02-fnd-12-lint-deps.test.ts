// V3-FND-02 (常駐DB禁止) + V3-FND-12 (依存方向・ツリー深度制限) + V3-CST-01 (従量課金
// SDK禁止) — lint-deps.mjs の拡張ぶんを vitest から駆動する契約テスト。gate 自体は
// `node scripts/lint-deps.mjs`(npm run lint に配線済み)。ここでは pure 関数を直接
// import して境界値を検証する。
import { describe, expect, it } from "vitest";
import { scanResidentDbDeps, scanMeteredApiDeps, checkTreeDepth } from "../scripts/lint-deps.mjs";

describe("V3-FND-02 scanResidentDbDeps (resident DB is not the SSOT)", () => {
  it("flags a known resident-DB/vector-store client in production dependencies", () => {
    expect(scanResidentDbDeps({ dependencies: { pg: "^8.0.0" } })).toEqual(["pg"]);
    expect(scanResidentDbDeps({ dependencies: { "@prisma/client": "^5.0.0" } })).toEqual([
      "@prisma/client",
    ]);
  });

  it("does not flag devDependencies (local test tooling is not the runtime SSOT)", () => {
    expect(scanResidentDbDeps({ devDependencies: { "better-sqlite3": "^11.0.0" } })).toEqual([]);
  });

  it("does not flag unrelated production dependencies", () => {
    expect(scanResidentDbDeps({ dependencies: { hono: "^4.6.0" } })).toEqual([]);
  });

  it("this repo's actual workspace package.json files are clean", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    for (const rel of [
      "../package.json",
      "../apps/api/package.json",
      "../apps/web/package.json",
      "../packages/truth/package.json",
      "../packages/schema-types/package.json",
      "../tests/package.json",
    ]) {
      const pkg = JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
      expect(scanResidentDbDeps(pkg)).toEqual([]);
    }
  });
});

describe("V3-CST-01 scanMeteredApiDeps (no per-user variable-cost SaaS SDK)", () => {
  it("flags a known metered AI/SaaS SDK in production dependencies", () => {
    expect(scanMeteredApiDeps({ dependencies: { openai: "^4.0.0" } })).toEqual(["openai"]);
  });

  it("does not flag devDependencies or unrelated deps", () => {
    expect(scanMeteredApiDeps({ devDependencies: { openai: "^4.0.0" } })).toEqual([]);
    expect(scanMeteredApiDeps({ dependencies: { hono: "^4.6.0" } })).toEqual([]);
  });

  it("this repo's actual workspace package.json files are clean", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    for (const rel of ["../apps/api/package.json", "../apps/web/package.json"]) {
      const pkg = JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
      expect(scanMeteredApiDeps(pkg)).toEqual([]);
    }
  });
});

describe("V3-FND-12 checkTreeDepth (constitution.md §4.1 tree-depth limits)", () => {
  it("docs/ max depth 4 (at limit passes, +1 fails)", () => {
    expect(checkTreeDepth("docs/a/b/c/d.md")).toBeNull();
    expect(checkTreeDepth("docs/a/b/c/d/e.md")).not.toBeNull();
  });

  it("scripts/ max depth 3", () => {
    expect(checkTreeDepth("scripts/lint-deps.mjs")).toBeNull();
    expect(checkTreeDepth("scripts/a/b/c/over.mjs")).not.toBeNull();
  });

  it("libs/<domain>/ max depth 2", () => {
    expect(checkTreeDepth("libs/vision/index.ts")).toBeNull();
    expect(checkTreeDepth("libs/vision/a/b/over.ts")).not.toBeNull();
  });

  it("components/<name>/ max depth 2 counted inside the component (name segment excluded)", () => {
    expect(checkTreeDepth("components/wiki-ingest/tests/x.py")).toBeNull();
    expect(checkTreeDepth("components/wiki-ingest/tests/sub/over.py")).not.toBeNull();
  });

  it("trees without a declared limit (apps/, packages/) are not depth-gated here", () => {
    expect(checkTreeDepth("apps/api/src/a/b/c/d/e/f.ts")).toBeNull();
  });
});
