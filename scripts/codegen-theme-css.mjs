#!/usr/bin/env node
// codegen: config/design-tokens.json -> apps/web/src/app/tokens.generated.css
//                                     + theme-packs/{minimal-light,minimal-dark}.json
// Direction is ONE-WAY: config/design-tokens.json -> generated. Never hand-edit the
// outputs; fix the SSOT and re-run. (逆流禁止 — V3-UIX-16 / design-k4 §1.2, §2)
//
// Usage:
//   node scripts/codegen-theme-css.mjs          # regenerate in place
//   node scripts/codegen-theme-css.mjs --check   # compare committed files, exit 1 on drift
//
// Output is deterministic (fixed key order, fixed banner) so re-runs are byte-identical.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SSOT = "config/design-tokens.json";
const CSS_OUT = "apps/web/src/app/tokens.generated.css";
const PACK_OUT = (id) => `theme-packs/${id}.json`;

// The 15 color tokens a ThemePack may fork (design-k4 §1.5). Order is canonical and
// MUST match apps/api/src/ui-constants.ts ThemePack token列 (separate file, same values).
// info/info-bg/caution/caution-bg added by V3-UIX-04 (色は意味のみ: 緑=成功/赤=失敗に加え
// 青=情報/黄=注意を区別可能にする。旧実装は caution が danger と同色で失敗と混同していた)。
export const COLOR_KEYS = [
  "bg", "surface", "surface-2", "text", "text-muted", "border",
  "primary", "primary-text", "focus", "danger", "danger-bg",
  "info", "info-bg", "caution", "caution-bg",
];
// Pack-invariant tokens (never forked; shared by every screen).
export const INVARIANT_KEYS = ["radius", "tap", "motion", "font", "fs-1", "fs-2", "fs-3", "fs-4"];
export const BUILTIN_PACK_IDS = ["minimal-light", "minimal-dark"];

/** Read + structurally validate the SSOT. Throws on any missing/extra token key. */
export function loadTokens(root = ROOT) {
  const doc = JSON.parse(readFileSync(join(root, SSOT), "utf8"));
  const inv = doc.invariant ?? {};
  for (const k of INVARIANT_KEYS) {
    if (typeof inv[k] !== "string") throw new Error(`design-tokens: invariant.${k} missing`);
  }
  const packs = doc.packs ?? {};
  for (const id of BUILTIN_PACK_IDS) {
    const p = packs[id];
    if (!p) throw new Error(`design-tokens: pack "${id}" missing`);
    if (p.mode !== (id === "minimal-dark" ? "dark" : "light")) {
      throw new Error(`design-tokens: pack "${id}" wrong mode "${p.mode}"`);
    }
    const keys = Object.keys(p.tokens ?? {}).sort();
    const want = [...COLOR_KEYS].sort();
    if (keys.length !== want.length || keys.some((k, i) => k !== want[i])) {
      throw new Error(`design-tokens: pack "${id}" must define exactly the 11 color keys, got [${keys}]`);
    }
    for (const k of COLOR_KEYS) {
      if (!/^#[0-9a-fA-F]{6}$/.test(p.tokens[k])) {
        throw new Error(`design-tokens: pack "${id}" token "${k}"="${p.tokens[k]}" is not a 6-digit hex`);
      }
    }
  }
  return doc;
}

const CSS_BANNER =
  "/* GENERATED FILE — do not edit by hand.\n" +
  ` * source: ${SSOT}\n` +
  " * direction: config/design-tokens.json -> tokens.generated.css (one-way; edit the SSOT, then re-run)\n" +
  " * regenerate: node scripts/codegen-theme-css.mjs\n" +
  " * ThemePack colour tokens (V3-UIX-16). Raw hex lives here because this is a token-definition\n" +
  " * view; check-ui-tokens.mjs exempts it and check-contrast.mjs reads its data-theme blocks. */\n";

const colorBlock = (tokens, indent) =>
  COLOR_KEYS.map((k) => `${indent}--civ-${k}: ${tokens[k]};`).join("\n");
const invariantBlock = (inv, indent) =>
  INVARIANT_KEYS.map((k) => `${indent}--civ-${k}: ${inv[k]};`).join("\n");

/** Build the 4-block themed CSS (base light + invariants / media dark / data-theme light / dark). */
export function buildCss(doc) {
  const light = doc.packs["minimal-light"].tokens;
  const dark = doc.packs["minimal-dark"].tokens;
  const inv = doc.invariant;
  return (
    CSS_BANNER +
    "\n/* --- Light pack (prefers-color-scheme default) + pack-invariant tokens --- */\n" +
    ":root {\n" + colorBlock(light, "  ") + "\n\n" + invariantBlock(inv, "  ") + "\n}\n" +
    "\n/* --- Dark pack (prefers-color-scheme: dark) --- */\n" +
    "@media (prefers-color-scheme: dark) {\n  :root {\n" + colorBlock(dark, "    ") + "\n  }\n}\n" +
    "\n/* --- data-theme hard overrides (win in both directions) --- */\n" +
    ':root[data-theme="light"] {\n' + colorBlock(light, "  ") + "\n}\n" +
    ':root[data-theme="dark"] {\n' + colorBlock(dark, "  ") + "\n}\n"
  );
}

/** Build one built-in ThemePack JSON for API distribution (design-k4 §1.1/§1.3 listThemePacks). */
export function buildPack(doc, id) {
  const p = doc.packs[id];
  return JSON.stringify(
    {
      $comment: `GENERATED FILE — do not edit by hand. source: ${SSOT}. regenerate: node scripts/codegen-theme-css.mjs`,
      pack_id: id,
      name: p.name,
      mode: p.mode,
      builtin: true,
      tokens: Object.fromEntries(COLOR_KEYS.map((k) => [k, p.tokens[k]])),
    },
    null,
    2,
  ) + "\n";
}

/** Deterministic map of relative output path -> file content. */
export function emitAll(root = ROOT) {
  const doc = loadTokens(root);
  const out = new Map();
  out.set(CSS_OUT, buildCss(doc));
  for (const id of BUILTIN_PACK_IDS) out.set(PACK_OUT(id), buildPack(doc, id));
  return out;
}

/** Compare freshly generated output against a committed {rel -> content} map. */
export function diffAgainst(committed, root = ROOT) {
  const drift = [];
  for (const [rel, content] of emitAll(root)) {
    const have = committed.get(rel);
    if (have === undefined) drift.push(`missing: ${rel}`);
    else if (have.replace(/\r\n/g, "\n") !== content) drift.push(`stale: ${rel}`);
  }
  return drift;
}

function readCommitted(root = ROOT) {
  const m = new Map();
  for (const rel of emitAll(root).keys()) {
    const full = join(root, rel);
    if (existsSync(full)) m.set(rel, readFileSync(full, "utf8"));
  }
  return m;
}

// Run only when invoked directly (importing for tests must not execute).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (process.argv.includes("--check")) {
    const drift = diffAgainst(readCommitted());
    if (drift.length) {
      console.error("codegen-theme-css --check FAILED: outputs out of sync with config/design-tokens.json.");
      for (const d of drift) console.error("  - " + d);
      console.error("fix: node scripts/codegen-theme-css.mjs  (never hand-edit generated files)");
      process.exit(1);
    }
    console.log(`codegen-theme-css --check OK (${emitAll().size} files in sync)`);
  } else {
    for (const [rel, content] of emitAll()) {
      const full = join(ROOT, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, "utf8");
    }
    console.log(`codegen-theme-css OK: wrote ${emitAll().size} files`);
  }
}
