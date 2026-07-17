// V3-AIP-93 file-board linkage: file_board_registry(csv) row count must match a
// fresh scan of 正本 Markdown(01-requirements/**/*.md, 02-design/**/*.md) +
// 画面(screen-defs/*.json). This test exercises the pure scan/build functions
// directly (no repo-root coupling) so it stays deterministic in CI.
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanTargets, buildCsv } from "../scripts/gen-file-board-registry.mjs";

function makeFixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "file-board-registry-"));
  mkdirSync(join(root, "01-requirements"), { recursive: true });
  mkdirSync(join(root, "02-design", "adr"), { recursive: true });
  mkdirSync(join(root, "screen-defs"), { recursive: true });
  writeFileSync(join(root, "01-requirements", "srs.md"), "# srs\n");
  writeFileSync(join(root, "01-requirements", "registry.json"), "{}"); // not .md — excluded
  writeFileSync(join(root, "02-design", "constitution.md"), "# constitution\n");
  writeFileSync(join(root, "02-design", "adr", "adr-001.md"), "# adr\n");
  writeFileSync(join(root, "screen-defs", "home.json"), "{}");
  writeFileSync(join(root, "screen-defs", "README.md"), "# not a screen-def\n"); // .md under screen-defs — excluded
  return root;
}

describe("V3-AIP-93 gen-file-board-registry scan + csv", () => {
  it("scans only 01-requirements/**/*.md + 02-design/**/*.md + screen-defs/*.json", () => {
    const root = makeFixtureRoot();
    try {
      const files = scanTargets(root);
      expect(files.sort()).toEqual(
        [
          "01-requirements/srs.md",
          "02-design/constitution.md",
          "02-design/adr/adr-001.md",
          "screen-defs/home.json",
        ].sort(),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("csv row count equals the scanned file count (registry can never silently drift)", () => {
    const root = makeFixtureRoot();
    try {
      const csv = buildCsv(root);
      const dataRows = csv.trim().split("\n").filter((l) => !l.startsWith("#") && !l.startsWith('"repo_path"'));
      expect(dataRows.length).toBe(scanTargets(root).length);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("every row carries a 10-char sha256_short and an empty (pending) board_thread_id", () => {
    const root = makeFixtureRoot();
    try {
      const csv = buildCsv(root);
      const dataRows = csv.trim().split("\n").filter((l) => !l.startsWith("#") && !l.startsWith('"repo_path"'));
      for (const row of dataRows) {
        const cells = row.split(",");
        expect(cells[1].replace(/"/g, "")).toMatch(/^[0-9a-f]{10}$/);
        expect(cells[2].replace(/"/g, "")).toBe("");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
