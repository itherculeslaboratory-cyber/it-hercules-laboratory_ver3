#!/usr/bin/env node
// GATE: filename lint (folder design §7.3 / §8 step 7a)
// Fails on: (a) non-ASCII characters anywhere in a tracked path,
//           (b) version-number suffix on a filename (e.g. foo-v1.md — lesson L2).
// Node-only, zero dependencies. Walks the repo (fs), skipping .git, node_modules
// and .claude (parallel-agent git worktrees checked out under .claude/worktrees/
// carry their own copies of the tree, including non-ASCII playwright artifacts —
// not repo content, must not be lint-scanned).
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SKIP = new Set([".git", "node_modules", ".claude"]);
const NON_ASCII = /[^\x00-\x7F]/;
const VERSION_SUFFIX = /-v\d+\.[a-z]+$/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    out.push(full);
    if (statSync(full).isDirectory()) walk(full, out);
  }
  return out;
}

const violations = [];
for (const full of walk(ROOT)) {
  const rel = relative(ROOT, full).replace(/\\/g, "/");
  const base = rel.split("/").pop();
  if (NON_ASCII.test(rel)) violations.push(`non-ascii path: ${rel}`);
  if (VERSION_SUFFIX.test(base)) violations.push(`version-suffix filename: ${rel}`);
}

if (violations.length) {
  console.error("filename lint FAILED:");
  for (const v of violations) console.error("  - " + v);
  process.exit(1);
}
console.log("filename lint OK");
