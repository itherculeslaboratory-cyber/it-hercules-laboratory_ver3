#!/usr/bin/env node
// codegen: schemas/**/*.schema.json -> packages/truth/src/generated/validators.mjs
//
// WHY: Ajv compiles JSON Schema to a validator by generating JS with `new
// Function`. The Cloudflare Workers runtime (workerd) forbids runtime code
// generation ("Code generation from strings disallowed"), so `ajv.compile()`
// at request time throws. Ajv "standalone" mode emits the SAME generated code
// ahead of time as a plain module — identical validation logic, zero runtime
// eval. envelope.ts imports these instead of compiling at runtime.
//
// Output is CommonJS (.cjs): the standalone code pulls ajv runtime helpers via
// require(), which native ESM (vitest) can't run but a .cjs module can — and
// esbuild (wrangler) bundles it for the worker. envelope.ts default-imports it.
//
// Direction is ONE-WAY: schemas/ -> generated. Never edit the output; fix the
// schema and re-run (逆流禁止 — AGENTS.md「スキーマの正本」).
//
// Usage:
//   node scripts/codegen-validators.mjs          # regenerate in place
//   node scripts/codegen-validators.mjs --check   # regen to temp, byte-compare
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const require = createRequire(join(ROOT, "packages", "truth", "package.json"));
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");
const standaloneCode = require("ajv/dist/standalone").default;

const OUT = join(ROOT, "packages", "truth", "src", "generated", "validators.cjs");

// exportName (valid JS id) -> schema file under schemas/. Fixed order = stable output.
// Must stay in sync with envelope.ts VALIDATORS map.
const SCHEMAS = [
  ["envelope", "events/envelope.schema.json"],
  ["obsCapture", "events/obs-capture.schema.json"],
  ["obsPhoto", "events/obs-photo.schema.json"],
  ["obsTemplate", "events/obs-template.schema.json"],
  ["indQr", "events/ind-qr.schema.json"],
  ["consentRecord", "frozen/consent-record.schema.json"],
  ["embeddingManifest", "frozen/embedding-manifest.schema.json"],
  ["individualKey", "frozen/individual-key.schema.json"],
  ["ledgerEntry", "frozen/ledger-entry.schema.json"],
  ["provenance", "frozen/provenance.schema.json"],
  ["qrToken", "frozen/qr-token.schema.json"],
  ["tagEvent", "frozen/tag-event.schema.json"],
  ["thumbnail", "frozen/thumbnail.schema.json"],
  ["transferCode", "frozen/transfer-code.schema.json"],
];

function generate() {
  // Same ajv config as the former runtime path (strict:false, allErrors), plus
  // code.source/esm to emit a standalone ES module.
  const ajv = new (Ajv2020.default ?? Ajv2020)({
    strict: false,
    allErrors: true,
    code: { source: true },
  });
  (addFormats.default ?? addFormats)(ajv);

  const refs = {};
  for (const [exportName, rel] of SCHEMAS) {
    const schema = JSON.parse(readFileSync(join(ROOT, "schemas", rel), "utf8"));
    ajv.addSchema(schema, exportName);
    refs[exportName] = exportName;
  }
  const banner =
    "// GENERATED FILE — do not edit by hand.\n" +
    "// source: schemas/**/*.schema.json (ajv standalone CJS; runtime-eval-free)\n" +
    "// direction: schemas/ -> generated (one-way; edit the schema, then re-run)\n" +
    "// regenerate: node scripts/codegen-validators.mjs\n";
  return banner + standaloneCode(ajv, refs).replace(/\r\n/g, "\n");
}

const out = generate();
if (process.argv.includes("--check")) {
  const committed = existsSync(OUT) ? readFileSync(OUT, "utf8").replace(/\r\n/g, "\n") : null;
  if (committed !== out) {
    console.error("codegen-validators --check FAILED: packages/truth/src/generated/validators.mjs is out of sync with schemas/.");
    console.error("fix: node scripts/codegen-validators.mjs  (never hand-edit generated files)");
    process.exit(1);
  }
  console.log("codegen-validators --check OK");
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, out, "utf8");
  console.log(`codegen-validators OK: wrote ${OUT}`);
}
