#!/usr/bin/env node
// check-contrast.mjs — WCAG AA GATE for the ThemePack (design-c2 §4.3 / V3-UIX-81
// "コントラスト AA（トークン値で担保）"). Parses the two authoritative token
// blocks in tokens.generated.css (:root[data-theme="light"|"dark"]), the codegen
// output of config/design-tokens.json (V3-UIX-16), and asserts every text/background
// pair the catalog actually paints meets 4.5:1 (normal text). Fails the lint chain
// if a token edit drops a pair below AA. No deps.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(resolve(root, "apps/web/src/app/tokens.generated.css"), "utf8");

// --- WCAG relative luminance + contrast ratio ---
function luminance(hex) {
  const h = hex.replace("#", "");
  const chan = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}
function ratio(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// Extract `--civ-x: #hex;` pairs from a named :root block.
function tokens(selector) {
  const block = css.match(
    new RegExp(selector.replace(/[[\]"]/g, "\\$&") + "\\s*\\{([^}]*)\\}"),
  );
  if (!block) {
    console.error(`check-contrast: token block not found: ${selector}`);
    process.exit(1);
  }
  const map = {};
  for (const m of block[1].matchAll(/--civ-([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    map[m[1]] = m[2];
  }
  return map;
}

const light = tokens(':root[data-theme="light"]');
const dark = tokens(':root[data-theme="dark"]');

// [foreground token, background token, minRatio] — the pairs actually rendered
// by the catalog (renderer.tsx / globals.css). 4.5:1 = AA normal text.
const PAIRS = [
  ["text", "bg", 4.5],
  ["text", "surface", 4.5],
  ["text", "surface-2", 4.5],
  ["text-muted", "bg", 4.5],
  ["text-muted", "surface", 4.5],
  ["primary-text", "primary", 4.5], // primary button label
  ["primary", "bg", 4.5], // link text
  ["primary", "surface", 4.5],
  ["danger", "bg", 4.5],
  ["danger", "danger-bg", 4.5],
  ["info", "bg", 4.5], // V3-UIX-04: 青=情報 バッジ
  ["info", "info-bg", 4.5],
  ["caution", "bg", 4.5], // V3-UIX-04: 黄=注意 バッジ(danger と別色で失敗と混同させない)
  ["caution", "caution-bg", 4.5],
];

let failed = 0;
for (const [theme, map] of [["light", light], ["dark", dark]]) {
  for (const [fg, bg, min] of PAIRS) {
    if (!map[fg] || !map[bg]) {
      console.error(`check-contrast: ${theme} missing token ${fg}/${bg}`);
      process.exit(1);
    }
    const r = ratio(map[fg], map[bg]);
    if (r < min) {
      failed++;
      console.error(
        `check-contrast FAILED: ${theme} ${fg}(${map[fg]}) on ${bg}(${map[bg]}) = ${r.toFixed(2)}:1 < ${min}:1`,
      );
    }
  }
}

if (failed) {
  console.error(`check-contrast: ${failed} pair(s) below WCAG AA.`);
  process.exit(1);
}
console.log("check-contrast OK (all ThemePack text pairs >= 4.5:1, both themes)");
