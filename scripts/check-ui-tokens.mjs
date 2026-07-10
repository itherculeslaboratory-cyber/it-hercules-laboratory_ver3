#!/usr/bin/env node
// GATE: ThemePack token discipline + ScreenDef schema (design-c2 §4.4).
//  (1) raw hex (#rrggbb) and arbitrary Tailwind color classes (bg-blue-500,
//      text-[#...]) are rejected in screen-defs/**/*.json and apps/web/**/*.{tsx,css}.
//      The ONE token-definition file (apps/web/src/app/globals.css) is exempt —
//      raw color lives there and everything else references var(--civ-*).
//  (2) every screen-defs/*.json validates against schemas/screendef.
// Node-only; ajv is already a repo dependency. scanColors() is exported so the
// Renderer negative TC can assert the GATE detects a violation.
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const require = createRequire(join(ROOT, "package.json"));

// Files where raw color is the source of truth (exempt from the scan).
const TOKEN_FILES = new Set(["apps/web/src/app/globals.css"]);

const RAW_HEX = /#[0-9a-fA-F]{3,8}\b/;
// Tailwind color-scale utility (bg-blue-500) or arbitrary color value (bg-[#abc]).
const COLOR_SCALE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const PREFIX =
  "bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|divide|accent|caret|placeholder|shadow";
const ARBITRARY_CLASS = new RegExp(
  `\\b(?:${PREFIX})-(?:\\[#[0-9a-fA-F]{3,8}\\]|(?:${COLOR_SCALE})-\\d{2,3})\\b`,
);

/** Return the list of color-discipline violations found in `text`. */
export function scanColors(text) {
  const out = [];
  const hex = text.match(RAW_HEX);
  if (hex) out.push(`raw hex color: ${hex[0]}`);
  const cls = text.match(ARBITRARY_CLASS);
  if (cls) out.push(`arbitrary color class: ${cls[0]}`);
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

function runGate() {
  const violations = [];

  // (1) color discipline
  const files = [
    ...walk(join(ROOT, "screen-defs"), [".json"]),
    ...walk(join(ROOT, "apps", "web"), [".tsx", ".css"]),
  ];
  for (const file of files) {
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    if (TOKEN_FILES.has(rel)) continue;
    for (const v of scanColors(readFileSync(file, "utf8"))) {
      violations.push(`${rel}: ${v}`);
    }
  }

  // (2) ScreenDef schema validation
  const schemaPath = join(ROOT, "schemas", "screendef", "screendef.schema.json");
  const screenDir = join(ROOT, "screen-defs");
  if (existsSync(schemaPath) && existsSync(screenDir)) {
    const Ajv2020 = require("ajv/dist/2020.js");
    const ajv = new (Ajv2020.default ?? Ajv2020)({ allErrors: true, strict: false });
    const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, "utf8")));
    for (const file of walk(screenDir, [".json"])) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      const doc = JSON.parse(readFileSync(file, "utf8"));
      if (!validate(doc)) {
        for (const e of validate.errors ?? []) {
          violations.push(`${rel}: schema ${e.instancePath || "/"} ${e.message}`);
        }
      }
    }
  }
  return violations;
}

// Run only when invoked directly (importing for tests must not execute).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const violations = runGate();
  if (violations.length) {
    console.error("ui-tokens GATE FAILED:");
    for (const v of violations) console.error("  - " + v);
    process.exit(1);
  }
  console.log("ui-tokens GATE OK");
}
