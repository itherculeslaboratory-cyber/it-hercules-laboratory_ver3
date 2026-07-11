#!/usr/bin/env node
// GATE: no "unimplemented / WIP" copy in user-facing UI (V3-UIX-01 / design-k4 §1.5).
// Scans the UI copy surfaces — screen-defs/**.json (ScreenDef text), apps/web/src/**
// (components/pages/lib UI strings) and i18n/**.json (message catalog) — for the
// FORBIDDEN_UI_WORDS. Build config, e2e specs and node_modules are NOT UI copy and
// are out of scope (scanning them would trip on this list's own literals).
// scanCopy(text) is exported so the TC can assert detection on both a bad and a
// clean string without touching the filesystem.
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

// design-k4 §1.5. Split by match strategy: CJK words are matched as substrings;
// ASCII words are matched case-insensitively on word boundaries so "WIP" does not
// fire inside "swiped" and "TODO" only fires as the token, not a substring.
export const FORBIDDEN_UI_WORDS = [
  "未実装", "WIP", "準備中", "工事中", "近日公開", "作成中", "coming soon", "TODO", "FIXME",
];

const CJK_WORDS = FORBIDDEN_UI_WORDS.filter((w) => /[^\x00-\x7f]/.test(w));
const ASCII_WORDS = FORBIDDEN_UI_WORDS.filter((w) => !/[^\x00-\x7f]/.test(w));
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// \b is unreliable next to a space ("coming soon"); anchor on non-word neighbours.
const ASCII_RE = new RegExp(`(?<![A-Za-z])(?:${ASCII_WORDS.map(escape).join("|")})(?![A-Za-z])`, "i");

/** Return the forbidden words found in `text` ([] = clean). */
export function scanCopy(text) {
  const out = [];
  for (const w of CJK_WORDS) if (text.includes(w)) out.push(w);
  const m = text.match(ASCII_RE);
  if (m) out.push(m[0]);
  return out;
}

function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

export function runGate(root = process.cwd()) {
  const files = [
    ...walk(join(root, "screen-defs"), [".json"]),
    ...walk(join(root, "apps", "web", "src"), [".tsx", ".ts", ".css"]),
    ...walk(join(root, "i18n"), [".json"]),
  ];
  const violations = [];
  for (const file of files) {
    const rel = relative(root, file).replace(/\\/g, "/");
    for (const w of scanCopy(readFileSync(file, "utf8"))) {
      violations.push(`${rel}: forbidden UI copy "${w}"`);
    }
  }
  return violations;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const violations = runGate();
  if (violations.length) {
    console.error("ui-copy GATE FAILED (V3-UIX-01):");
    for (const v of violations) console.error("  - " + v);
    process.exit(1);
  }
  console.log("ui-copy GATE OK");
}
