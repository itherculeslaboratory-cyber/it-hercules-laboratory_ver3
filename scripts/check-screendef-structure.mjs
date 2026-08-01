#!/usr/bin/env node
// GATE: ScreenDef structural discipline (V3-UIX-05 / design-k4 §1.4, §3).
//   (a) at most 3 `section` nodes per screen
//   (b) at most 3 `card` nodes per screen
//   (c) a forward affordance exists (a transition, a navigate action, a link,
//       or an explicit props.next_step) — no dead-end screen
//   (d) no single text runs longer than 3 lines
//
// Scope = the screens THIS cluster owns/authored (design-k4 §1.4). Other clusters'
// screens (e.g. profile with 4 cards, bio-card as a leaf) carry their own structure
// budget and are validated by their own clusters — mirroring check-i18n-keys' scope.
// checkStructure(def) is exported so the TC can drive each violation branch on
// crafted defs and assert every cluster-owned real def passes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadScreenDefs } from "./check-navigation.mjs";

// design-k4 §1.4/§5 — the 10 K4 (converted + new) screens.
export const CLUSTER_OWNED = [
  "home", "settings", "theme-gallery", "ui-templates", "login", "login-sent",
  "obs-entry", "obs-detail", "individual-detail", "qr-resume",
];

const MAX_SECTIONS = 3;
const MAX_CARDS = 3;
const MAX_TEXT_LINES = 3;

/** Flatten a ScreenDef's node tree (children[] recursion) to a flat list. */
export function flattenNodes(def) {
  const out = [];
  const visit = (n) => {
    if (!n || typeof n !== "object") return;
    out.push(n);
    for (const c of n.children ?? []) visit(c);
  };
  for (const n of def.nodes ?? []) visit(n);
  return out;
}

/** Structural violations for one ScreenDef ([] = valid). */
export function checkStructure(def) {
  const v = [];
  const nodes = flattenNodes(def);
  const count = (t) => nodes.filter((n) => n.type === t).length;

  const sections = count("section");
  if (sections > MAX_SECTIONS) v.push(`too many sections: ${sections} (max ${MAX_SECTIONS})`);
  const cards = count("card");
  if (cards > MAX_CARDS) v.push(`too many cards: ${cards} (max ${MAX_CARDS})`);

  // (c) forward affordance — the screen must offer at least one way onward.
  const hasForward =
    (def.transitions?.length ?? 0) > 0 ||
    nodes.some((n) => n.action?.kind === "navigate") ||
    nodes.some((n) => n.type === "link" && n.props?.href) ||
    nodes.some((n) => n.props?.next_step);
  if (!hasForward) v.push("no forward affordance (transition/navigate/link/next_step)");

  // (d) text length
  for (const n of nodes) {
    const t = n.props?.text;
    if (typeof t === "string" && t.split("\n").length > MAX_TEXT_LINES) {
      v.push(`text over ${MAX_TEXT_LINES} lines: node ${n.id ?? "?"}`);
    }
  }
  return v;
}

// (V3-UIX-06) each screen offers at most one primary CTA at a time. Buttons
// scoped to different tabs (props.tab_id) are not simultaneously visible, so
// they are counted per tab_id bucket rather than globally (market-trade.json
// etc. legitimately have one primary action per tab). A `when` guard — on the
// button itself OR any ancestor (e.g. a `form` wrapping the button, as in
// dispute.json's message-form/open-form) — makes it conditionally rendered;
// two guarded primaries in the same tab are exempted from this check because
// their mutual exclusivity depends on runtime data this static check cannot
// evaluate — only unconditional coexistence (no `when` anywhere in the
// ancestor chain of either button) is flagged as a hard violation.
export function checkPrimaryCta(def) {
  const v = [];
  const primaries = [];
  const visit = (n, guarded) => {
    if (!n || typeof n !== "object") return;
    const g = guarded || n.props?.when !== undefined;
    if (n.type === "button" && n.props?.variant === "primary") primaries.push({ n, guarded: g });
    for (const c of n.children ?? []) visit(c, g);
  };
  for (const n of def.nodes ?? []) visit(n, false);

  const byTab = new Map();
  for (const p of primaries) {
    const tab = p.n.props?.tab_id ?? "_default";
    if (!byTab.has(tab)) byTab.set(tab, []);
    byTab.get(tab).push(p);
  }
  for (const [tab, nodesInTab] of byTab) {
    const unconditional = nodesInTab.filter((p) => !p.guarded);
    if (unconditional.length > 1) {
      const ids = unconditional.map((p) => p.n.id ?? "?").join(", ");
      v.push(`multiple unconditional primary CTAs in tab "${tab}": ${ids}`);
    }
  }
  return v;
}

// A source_path must interpolate with `{{path}}`; a lone `{listing_id}` is sent
// literally (Renderer only fills `{{...}}`) → the fetch 404s silently. Strip the
// valid `{{…}}` pairs and any brace left over is a single-brace bug.
export function checkSourcePaths(def) {
  const v = [];
  for (const n of flattenNodes(def)) {
    const sp = n.props?.source_path;
    if (typeof sp !== "string") continue;
    const stripped = sp.replace(/\{\{/g, "").replace(/\}\}/g, "");
    if (stripped.includes("{") || stripped.includes("}")) {
      v.push(`single-brace source_path (use {{…}}): node ${n.id ?? "?"} "${sp}"`);
    }
  }
  return v;
}

export function runGate(root = process.cwd()) {
  const dir = join(root, "screen-defs");
  const defs = loadScreenDefs(dir);
  const byId = new Map(defs.map((d) => [d.screen_id, d]));
  const violations = [];
  for (const id of CLUSTER_OWNED) {
    const def = byId.get(id);
    if (!def) {
      violations.push(`${id}: cluster-owned screen-def missing`);
      continue;
    }
    for (const msg of checkStructure(def)) violations.push(`${id}: ${msg}`);
  }
  // source_path interpolation is checked on ALL screens (any cluster) — a
  // single-brace path silently breaks data binding regardless of ownership.
  for (const def of defs) {
    for (const msg of checkSourcePaths(def)) violations.push(`${def.screen_id}: ${msg}`);
  }
  // (V3-UIX-06) primary-CTA discipline, checked on ALL screens. 1 pre-existing
  // screen fails this at gate-introduction time (2026-08-01 g77-uibatch2 T
  // UIB03-1 dry-run over all 53 on-disk screen-defs) and is excluded rather
  // than silently "fixed" here (out of this gate-addition's scope — a design
  // judgment is needed, not a mechanical edit):
  //   - market-trade: btn-publish + btn-match both unconditional/primary in
  //     tab "1" — looks like a real violation (no viewer-role `when` guard
  //     distinguishes seller-only vs buyer-only actions the way btn-pay-declare/
  //     btn-pay-confirm do a few nodes later in the same file).
  //   - obs-domain-select was exempted here for the same reason (5 domain-choice
  //     buttons all "primary") but the screen was retired 2026-08-01 (カード
  //     R0801-9d452f=ユーザー○90+b1think裁定A案・R0801-439da4)。除外は画面ごと消滅済み。
  const PRIMARY_CTA_EXEMPT = new Set(["market-trade"]);
  for (const def of defs) {
    if (PRIMARY_CTA_EXEMPT.has(def.screen_id)) continue;
    for (const msg of checkPrimaryCta(def)) violations.push(`${def.screen_id}: ${msg}`);
  }
  return violations;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const violations = runGate();
  if (violations.length) {
    console.error("screendef-structure GATE FAILED (V3-UIX-05):");
    for (const v of violations) console.error("  - " + v);
    process.exit(1);
  }
  console.log("screendef-structure GATE OK");
}
