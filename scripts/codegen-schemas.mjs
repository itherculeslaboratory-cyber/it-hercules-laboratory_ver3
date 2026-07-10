#!/usr/bin/env node
// codegen: schemas/**/*.schema.json -> packages/schema-types/src/generated/*.ts
// Direction is ONE-WAY: schemas/ -> generated. Never edit generated files;
// fix the schema and re-run. (逆流禁止 — AGENTS.md「スキーマの正本」)
//
// Usage:
//   node scripts/codegen-schemas.mjs          # regenerate in place
//   node scripts/codegen-schemas.mjs --check  # regen to temp dir, byte-compare, exit 1 on drift
//
// Output is deterministic (sorted file order, fixed banner) so re-runs are byte-identical.
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, relative, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const SCHEMAS_DIR = join(ROOT, "schemas");
const OUT_DIR = join(ROOT, "packages", "schema-types", "src", "generated");

const require = createRequire(join(ROOT, "packages", "schema-types", "package.json"));
const { compile } = require("json-schema-to-typescript");

function walkSchemas(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkSchemas(full, out);
    else if (name.endsWith(".schema.json")) out.push(full);
  }
  return out;
}

function pascal(kebab) {
  return kebab.split(/[^a-zA-Z0-9]+/).filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1)).join("");
}

async function generate(outDir) {
  const files = walkSchemas(SCHEMAS_DIR); // sorted walk -> stable order
  const emitted = new Map(); // rel out path -> content
  const indexLines = [];
  for (const file of files) {
    const relSchema = relative(ROOT, file).replace(/\\/g, "/");
    const schema = JSON.parse(readFileSync(file, "utf8"));
    const base = basename(file, ".schema.json");
    const typeName = pascal(base);
    const originalTitle = schema.title ?? "";
    schema.title = typeName; // stable identifier; original title kept in header below
    const header = [
      "// GENERATED FILE — do not edit by hand.",
      `// source: ${relSchema}`,
      originalTitle ? `// title: ${originalTitle}` : null,
      "// direction: schemas/ -> generated (one-way; edit the schema, then re-run)",
      "// regenerate: node scripts/codegen-schemas.mjs",
    ].filter(Boolean).join("\n");
    const ts = await compile(schema, typeName, {
      bannerComment: header,
      additionalProperties: false,
      cwd: dirname(file),
    });
    const relOut = relative(SCHEMAS_DIR, file).replace(/\\/g, "/").replace(/\.schema\.json$/, ".ts");
    emitted.set(relOut, ts.replace(/\r\n/g, "\n"));
    indexLines.push(`export * from "./${relOut.replace(/\.ts$/, "")}";`);
  }
  emitted.set("index.ts", [
    "// GENERATED FILE — do not edit by hand.",
    "// source: schemas/**/*.schema.json",
    "// direction: schemas/ -> generated (one-way; edit the schema, then re-run)",
    "// regenerate: node scripts/codegen-schemas.mjs",
    ...indexLines,
    "",
  ].join("\n"));

  for (const [rel, content] of emitted) {
    const full = join(outDir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return emitted;
}

function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

const isCheck = process.argv.includes("--check");
if (isCheck) {
  const tmp = join(tmpdir(), `ihl-codegen-check-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true });
  const emitted = await generate(tmp);
  const drift = [];
  for (const [rel] of emitted) {
    const committed = join(OUT_DIR, rel);
    if (!existsSync(committed)) { drift.push(`missing: ${rel}`); continue; }
    if (readFileSync(committed, "utf8").replace(/\r\n/g, "\n") !== readFileSync(join(tmp, rel), "utf8")) {
      drift.push(`stale: ${rel}`);
    }
  }
  const expected = new Set(emitted.keys());
  for (const f of walkFiles(OUT_DIR)) {
    const rel = relative(OUT_DIR, f).replace(/\\/g, "/");
    if (!expected.has(rel)) drift.push(`orphan (schema removed?): ${rel}`);
  }
  rmSync(tmp, { recursive: true, force: true });
  if (drift.length) {
    console.error("codegen --check FAILED: packages/schema-types/src/generated/ is out of sync with schemas/.");
    for (const d of drift) console.error("  - " + d);
    console.error("fix: node scripts/codegen-schemas.mjs  (never hand-edit generated files)");
    process.exit(1);
  }
  console.log(`codegen --check OK (${emitted.size} files in sync)`);
} else {
  const emitted = await generate(OUT_DIR);
  console.log(`codegen OK: wrote ${emitted.size} files to packages/schema-types/src/generated/`);
}
