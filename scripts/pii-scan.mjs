#!/usr/bin/env node
// V3-SEC-07 batch scanner. Masks a corpus of source files into <outDir>/masked/
// and emits <outDir>/pii-candidates.json (human-gate review list) and
// <outDir>/pii-diff.json (per-file span diffs: what was masked and where).
// Single engine: imports maskPii from apps/api/src/pii.mjs (no second detector).
// srcDir is READ-ONLY — originals are never mutated (原本隔離); masked copies go
// under outDir only. runScan(srcDir, outDir) is exported for the TC.
//
// Usage: node scripts/pii-scan.mjs <srcDir> <outDir>
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { maskPii } from "../apps/api/src/pii.mjs";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * @param {string} srcDir corpus root (not modified)
 * @param {string} outDir destination for masked/ + candidates + diff
 * @returns {{candidates:object[], diffs:object[]}}
 */
export function runScan(srcDir, outDir) {
  const maskedDir = join(outDir, "masked");
  const candidates = [];
  const diffs = [];
  for (const file of walk(srcDir)) {
    const rel = relative(srcDir, file).replace(/\\/g, "/");
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // unreadable/binary — skip
    }
    const { masked, findings } = maskPii(text);
    const dest = join(maskedDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, masked);
    if (findings.length) {
      candidates.push({ file: rel, count: findings.length, types: [...new Set(findings.map((f) => f.type))] });
      diffs.push({
        file: rel,
        spans: findings.map((f) => ({ type: f.type, start: f.start, end: f.end, original: text.slice(f.start, f.end) })),
      });
    }
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "pii-candidates.json"), JSON.stringify(candidates, null, 2));
  writeFileSync(join(outDir, "pii-diff.json"), JSON.stringify(diffs, null, 2));
  return { candidates, diffs };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [srcDir, outDir] = process.argv.slice(2);
  if (!srcDir || !outDir) {
    console.error("usage: node scripts/pii-scan.mjs <srcDir> <outDir>");
    process.exit(2);
  }
  const { candidates } = runScan(srcDir, outDir);
  console.log(`pii-scan: masked into ${join(outDir, "masked")}, ${candidates.length} file(s) with PII candidates`);
}
