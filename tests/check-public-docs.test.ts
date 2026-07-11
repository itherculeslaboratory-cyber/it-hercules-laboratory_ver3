// V3-SEC-31 — public-docs existence GATE. checkPublicDocs fails when any of the
// required docs is missing and passes for the real repo root where all exist.
// (LICENSE = Apache 2.0 は第12回裁定 2026-07-11 で確定済み・REQUIRED に復帰。)
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPublicDocs, REQUIRED_PUBLIC_DOCS } from "../scripts/check-public-docs.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("V3-SEC-31 checkPublicDocs(existence gate)", () => {
  it("passes on the real repo root where all required docs exist", () => {
    expect(checkPublicDocs(REPO_ROOT)).toEqual([]);
  });

  it("fails when one required doc is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "pubdocs-"));
    try {
      // create all but the first required doc
      for (const rel of REQUIRED_PUBLIC_DOCS.slice(1)) writeFileSync(join(dir, rel), "x");
      expect(checkPublicDocs(dir)).toEqual([REQUIRED_PUBLIC_DOCS[0]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails with an empty dir listing every required doc", () => {
    const dir = mkdtempSync(join(tmpdir(), "pubdocs-"));
    try {
      expect(checkPublicDocs(dir).sort()).toEqual([...REQUIRED_PUBLIC_DOCS].sort());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
