#!/usr/bin/env node
// GATE: generated-file guard (folder design §4.1 / §8 step 7c)
// Every file under docs/generated/** and packages/**/src/generated/** must carry a
// GENERATED header (逆流禁止 — hand-editing generated views is forbidden).
// Missing directories = pass. Node-only, zero dependencies.
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

// Collect target dirs: docs/generated  +  packages/<any>/src/generated (any depth under packages)
const targets = [join(ROOT, "docs", "generated")];
const pkgRoot = join(ROOT, "packages");
if (existsSync(pkgRoot)) {
  const stack = [pkgRoot];
  while (stack.length) {
    const d = stack.pop();
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (!statSync(full).isDirectory()) continue;
      if (name === "generated" && full.replace(/\\/g, "/").endsWith("/src/generated")) targets.push(full);
      else stack.push(full);
    }
  }
}

const violations = [];
for (const dir of targets) {
  for (const file of walkFiles(dir)) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("GENERATED")) {
      violations.push(relative(ROOT, file).replace(/\\/g, "/"));
    }
  }
}

if (violations.length) {
  console.error("generated-file guard FAILED (missing GENERATED header):");
  for (const v of violations) console.error("  - " + v);
  process.exit(1);
}
console.log("generated-file guard OK");
