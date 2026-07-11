#!/usr/bin/env node
// GATE: required public documents must exist (V3-SEC-31). The repo is published
// as a single public clone (不変条項②), so the governance/legal front matter must
// be present before publish. Issuing the files is reversible; Apache 2.0 の最終確定
// と公開の実施そのものは人間ゲート — this GATE only enforces existence, not content.
// checkPublicDocs(root) is exported for the TC (returns the list of missing docs).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const REQUIRED_PUBLIC_DOCS = [
  "MANIFESTO.md",
  "README.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  // LICENSE = Apache 2.0 は第12回裁定(2026-07-11)で人間確定済み。
  "LICENSE",
];

/** Return the required public docs missing from `root` ([] = all present). */
export function checkPublicDocs(root) {
  return REQUIRED_PUBLIC_DOCS.filter((rel) => !existsSync(join(root, rel)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const missing = checkPublicDocs(process.cwd());
  if (missing.length) {
    console.error("public-docs GATE FAILED (required file missing):");
    for (const m of missing) console.error("  - " + m);
    process.exit(1);
  }
  console.log("public-docs GATE OK");
}
