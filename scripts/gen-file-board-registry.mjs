#!/usr/bin/env node
// codegen: 04-traceability/file-board-registry.csv (V3-AIP-93 file-board linkage).
// Every 正本 Markdown (01-requirements/**/*.md, 02-design/**/*.md) and every 画面
// (screen-defs/*.json) gets exactly one row: repo_path + sha256_short(content) +
// board_thread_id (pending until a real 開発掲示板スレ is created — this script
// never fabricates thread content, only the deterministic file-identity half of
// the 1:1 linkage). Row count == scanned file count BY CONSTRUCTION (the CSV is
// regenerated from the same walk every time), so drift (--check) is what actually
// catches a 正本 file added/removed without updating the registry (silent-move
// guard, same spirit as C2 「サイレント move 禁止」).
//
// Usage:
//   node scripts/gen-file-board-registry.mjs          # regenerate in place
//   node scripts/gen-file-board-registry.mjs --check  # regen in memory, byte-compare, exit 1 on drift
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";

// Repo root, resolved from this file's own location — NOT process.cwd(). Callers
// (tests/, apps/api, apps/web) are each their own npm workspace with a different
// cwd when `npm test` runs them, so cwd-based lookup silently breaks outside the
// repo root. (Same pattern as scripts/scorecard-gate.mjs.)
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, "..");
const OUT = join(ROOT, "04-traceability", "file-board-registry.csv");

const MD_DIRS = ["01-requirements", "02-design"];
const SCREEN_DEF_DIR = "screen-defs";

function walkFiles(root, dir, out = []) {
  const full = join(root, dir);
  if (!existsSync(full)) return out;
  for (const name of readdirSync(full)) {
    const p = join(full, name);
    if (statSync(p).isDirectory()) walkFiles(root, relative(root, p), out);
    else out.push(relative(root, p).replace(/\\/g, "/"));
  }
  return out;
}

// Exported for tests: which files get a row (01-requirements/**/*.md + 02-design/**/*.md + screen-defs/*.json).
export function scanTargets(root = ROOT) {
  const files = [];
  for (const d of MD_DIRS) {
    for (const f of walkFiles(root, d)) if (f.endsWith(".md")) files.push(f);
  }
  for (const f of walkFiles(root, SCREEN_DEF_DIR)) if (f.endsWith(".json")) files.push(f);
  return files.sort();
}

function csvCell(s) {
  return '"' + String(s).replace(/"/g, '""') + '"';
}

// Exported for tests: pure builder over an explicit root (no process.cwd() coupling).
export function buildCsv(root = ROOT) {
  const lines = [
    "# GENERATED FILE — do not edit by hand.",
    "# source: repo scan of 01-requirements/**/*.md + 02-design/**/*.md + screen-defs/*.json (V3-AIP-93)",
    "# regenerate: node scripts/gen-file-board-registry.mjs",
    ["repo_path", "sha256_short", "board_thread_id"].map(csvCell).join(","),
  ];
  for (const repoPath of scanTargets(root)) {
    const content = readFileSync(join(root, repoPath), "utf8");
    const sha256Short = createHash("sha256").update(content).digest("hex").slice(0, 10);
    lines.push([repoPath, sha256Short, ""].map(csvCell).join(","));
  }
  return lines.join("\n") + "\n";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const csv = buildCsv();
  if (process.argv.includes("--check")) {
    const have = existsSync(OUT) ? readFileSync(OUT, "utf8").replace(/\r\n/g, "\n") : null;
    if (have !== csv) {
      console.error("gen-file-board-registry --check FAILED: file-board-registry.csv out of sync with repo scan.");
      console.error("fix: node scripts/gen-file-board-registry.mjs  (never hand-edit the generated csv)");
      process.exit(1);
    }
    console.log("gen-file-board-registry --check OK");
  } else {
    writeFileSync(OUT, csv, "utf8");
    console.log(`gen-file-board-registry OK: wrote ${OUT}`);
  }
}
