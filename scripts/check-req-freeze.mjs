#!/usr/bin/env node
// GATE: requirement-freeze (V3-AIP-32). If a PR touches FR text under
// 01-requirements/ it MUST also touch docs/planning/rulings/ — a requirement can
// only change through a recorded 裁定 (ruling). mjs-ification of the existing
// "Frozen schema change gate" (ci.yml) logic, reused for the requirements freeze.
//
// base/head SHA come from CI env (BASE_SHA / HEAD_SHA, or the GitHub PR context).
// checkReqFreeze(changedFiles) is exported so guards.test.ts can drive it with a
// synthetic file list — no git required.
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const REQ_PREFIX = "01-requirements/";
const RULING_PREFIX = "docs/planning/rulings/";

/**
 * @param {string[]} changedFiles repo-relative paths changed in the PR.
 * @returns {string[]} violations ([] = ok). Fails when a requirement file changed
 *   but no ruling file did.
 */
export function checkReqFreeze(changedFiles) {
  const norm = changedFiles.map((f) => f.replace(/\\/g, "/"));
  const reqChanged = norm.filter((f) => f.startsWith(REQ_PREFIX));
  if (reqChanged.length === 0) return [];
  const rulingChanged = norm.some((f) => f.startsWith(RULING_PREFIX));
  if (rulingChanged) return [];
  return reqChanged.map(
    (f) => `${f} changed without a ${RULING_PREFIX} ruling in the same PR (裁定参照必須).`,
  );
}

function changedFilesFromGit() {
  const base = process.env.BASE_SHA;
  const head = process.env.HEAD_SHA ?? "HEAD";
  if (!base) return null; // not a PR context / no base — gate not applicable.
  const out = execSync(`git diff --name-only ${base} ${head}`, { encoding: "utf8" });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const changed = changedFilesFromGit();
  if (changed == null) {
    console.log("req-freeze GATE: no BASE_SHA — not a PR context, skipped.");
    process.exit(0);
  }
  const violations = checkReqFreeze(changed);
  if (violations.length === 0) {
    console.log("req-freeze GATE OK.");
    process.exit(0);
  }
  console.error("req-freeze GATE FAILED:");
  for (const v of violations) console.error("  - " + v);
  process.exit(1);
}
