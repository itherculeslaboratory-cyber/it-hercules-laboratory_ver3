#!/usr/bin/env node
// GATE: i18n key integrity for cluster-owned screens (V3-I18-08 / design-k4 §3).
//   (a) every text_key/label_key referenced by a cluster-owned ScreenDef exists
//       in the always-filled catalog i18n/ja.json (a missing key would render the
//       raw literal or an empty string).
//   (b) no raw-CJK display copy left un-keyed: a node's props.text / props.label
//       that contains CJK MUST also carry text_key / label_key (I18-08 直書き禁止).
//
// Scope = the 10 K4 (converted + new) screens only. The other 15 screen-defs are
// authored by other clusters and NOT yet text_key-converted (raw CJK is expected
// there); scanning them would false-fail. Only display props (text/label) are
// scanned — option/placeholder/next_step/bind copy are data, not the i18n surface.
// checkI18nKeys(def, catalog) is exported for the TC.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadScreenDefs } from "./check-navigation.mjs";
import { flattenNodes, CLUSTER_OWNED } from "./check-screendef-structure.mjs";

// Hiragana + katakana (U+3040–30FF), CJK ideographs (U+3400–9FFF), halfwidth
// katakana (U+FF66–FF9F). Covers Japanese display copy.
const CJK = /[぀-ヿ㐀-鿿ｦ-ﾟ]/;

/** i18n violations for one ScreenDef against a catalog ([] = valid). */
export function checkI18nKeys(def, catalog) {
  const v = [];
  for (const n of flattenNodes(def)) {
    const p = n.props ?? {};
    const id = n.id ?? "?";
    if (typeof p.text_key === "string" && !(p.text_key in catalog))
      v.push(`missing catalog key: ${p.text_key} (node ${id})`);
    if (typeof p.label_key === "string" && !(p.label_key in catalog))
      v.push(`missing catalog key: ${p.label_key} (node ${id})`);
    if (typeof p.text === "string" && CJK.test(p.text) && typeof p.text_key !== "string")
      v.push(`raw CJK text without text_key: node ${id}`);
    if (typeof p.label === "string" && CJK.test(p.label) && typeof p.label_key !== "string")
      v.push(`raw CJK label without label_key: node ${id}`);
  }
  return v;
}

export function loadCatalog(root = process.cwd()) {
  return JSON.parse(readFileSync(join(root, "i18n", "ja.json"), "utf8"));
}

export function runGate(root = process.cwd()) {
  const catalog = loadCatalog(root);
  const byId = new Map(loadScreenDefs(join(root, "screen-defs")).map((d) => [d.screen_id, d]));
  const violations = [];
  for (const id of CLUSTER_OWNED) {
    const def = byId.get(id);
    if (!def) {
      violations.push(`${id}: cluster-owned screen-def missing`);
      continue;
    }
    for (const msg of checkI18nKeys(def, catalog)) violations.push(`${id}: ${msg}`);
  }
  return violations;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const violations = runGate();
  if (violations.length) {
    console.error("i18n-keys GATE FAILED (V3-I18-08):");
    for (const v of violations) console.error("  - " + v);
    process.exit(1);
  }
  console.log("i18n-keys GATE OK");
}
