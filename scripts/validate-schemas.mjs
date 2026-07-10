#!/usr/bin/env node
// GATE: JSON Schema validation (folder design §8 step 7d)
// Every schemas/**/*.json must JSON.parse and carry $schema + $id keys.
// NOTE: this is a shallow structural check only. Full ajv compile/validation
// (draft 2020-12) is introduced in C1 — see folder design §2 / task spec.
// Missing schemas/ directory = pass. Node-only, zero dependencies.
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const schemasDir = join(ROOT, "schemas");

function walkJson(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkJson(full, out);
    else if (name.endsWith(".json")) out.push(full);
  }
  return out;
}

if (!existsSync(schemasDir)) {
  console.log("schema validation OK (schemas/ not present yet — skipped)");
  process.exit(0);
}

const violations = [];
for (const file of walkJson(schemasDir)) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    violations.push(`${rel}: invalid JSON (${e.message})`);
    continue;
  }
  if (typeof doc !== "object" || doc === null) {
    violations.push(`${rel}: not a JSON object`);
    continue;
  }
  if (!("$schema" in doc)) violations.push(`${rel}: missing $schema`);
  if (!("$id" in doc)) violations.push(`${rel}: missing $id`);
}

if (violations.length) {
  console.error("schema validation FAILED:");
  for (const v of violations) console.error("  - " + v);
  process.exit(1);
}
console.log("schema validation OK");
