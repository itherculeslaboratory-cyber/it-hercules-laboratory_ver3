#!/usr/bin/env node
// GATE: required public documents must exist (V3-SEC-31). LICENSE is excluded
// until the human gate "LICENSE 確定" rules on it (status.md 人間ゲート一覧).
// The repo is published
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
  // "LICENSE" は人間ゲート「LICENSE 確定」の裁定後にここへ追加する。
  // 候補本文(Apache 2.0)は docs/planning/c5/license-material-apache-2.0.txt に材料として提示済み。
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
