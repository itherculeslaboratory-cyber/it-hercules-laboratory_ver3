#!/usr/bin/env node
// GATE: frontmatter required keys (folder design §3.2 / §4.3 / §8 step 7b)
// Every .md under 01-requirements/ and 02-design/ must open with a YAML
// frontmatter block (--- ... ---) containing id, title, date, status.
// Missing directories = pass. Node-only, zero dependencies.
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const DIRS = ["01-requirements", "02-design"];
const REQUIRED = ["id", "title", "date", "status"];

function walkMd(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkMd(full, out);
    else if (name.endsWith(".md")) out.push(full);
  }
  return out;
}

const violations = [];
for (const d of DIRS) {
  for (const file of walkMd(join(ROOT, d))) {
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const m = text.match(/^---\n([\s\S]*?)\n---/);
    if (!m) {
      violations.push(`${rel}: missing YAML frontmatter block`);
      continue;
    }
    const keys = new Set(
      m[1].split("\n").map((l) => l.match(/^([A-Za-z0-9_]+):/)).filter(Boolean).map((x) => x[1])
    );
    const missing = REQUIRED.filter((k) => !keys.has(k));
    if (missing.length) violations.push(`${rel}: missing frontmatter keys [${missing.join(", ")}]`);
  }
}

if (violations.length) {
  console.error("frontmatter check FAILED:");
  for (const v of violations) console.error("  - " + v);
  process.exit(1);
}
console.log("frontmatter check OK");
