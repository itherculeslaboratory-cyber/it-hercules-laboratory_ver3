#!/usr/bin/env node
// codegen: screen-defs/*.json (SSOT) -> apps/web/src/renderer/screendef-snapshots.test.tsx
// One render-snapshot TC per on-disk screen-def: the single Renderer must draw
// EVERY screen without throwing and produce a heading (V3-AIP-50). The screen-id
// list is baked into the generated file, so adding/removing a screen-def drifts
// the file and --check fails until re-run — that is the traceability gate.
//
// Direction is ONE-WAY: screen-defs/ -> generated test. Never hand-edit the
// .tsx (逆流禁止). navigation.json is a flow map, not a ScreenDef — excluded,
// mirroring apps/web/src/lib/screendefs.ts allScreenDefIds().
//
// Usage:
//   node scripts/gen-screendef-snapshots.mjs          # regenerate in place
//   node scripts/gen-screendef-snapshots.mjs --check  # byte-compare, exit 1 on drift
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SCREENDEFS = join(ROOT, "screen-defs");
const OUT = join(ROOT, "apps", "web", "src", "renderer", "screendef-snapshots.test.tsx");

function screenIds() {
  return readdirSync(SCREENDEFS)
    .filter((f) => f.endsWith(".json") && f !== "navigation.json")
    .map((f) => f.replace(/\.json$/, ""))
    .sort(); // stable, order-independent of the OS readdir order
}

function generate() {
  const ids = screenIds();
  const list = ids.map((id) => `  ${JSON.stringify(id)},`).join("\n");
  return `// GENERATED FILE — do not edit by hand.
// source: screen-defs/*.json (navigation.json excluded)
// direction: screen-defs/ -> generated (one-way; edit the screen-def, then re-run)
// regenerate: node scripts/gen-screendef-snapshots.mjs
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Renderer } from "./renderer";
import { allScreenDefIds, loadScreenDef } from "@/lib/screendefs";

// Baked from the on-disk screen-def set at generation time. Drift (a screen-def
// added or removed without regenerating) fails codegen:check and the count guard.
const SCREEN_IDS = [
${list}
];

afterEach(() => cleanup());

describe("ScreenDef snapshots — every screen-def renders (V3-AIP-50)", () => {
  it("covers exactly the on-disk screen-def set (regenerate on drift)", () => {
    expect(SCREEN_IDS.length).toBe(allScreenDefIds().length);
  });

  it.each(SCREEN_IDS)("renders %s without throwing (heading present)", (id) => {
    const { unmount } = render(<Renderer def={loadScreenDef(id)} onAction={vi.fn()} />);
    expect(screen.getAllByRole("heading").length).toBeGreaterThan(0);
    unmount();
  });
});
`;
}

const out = generate();
if (process.argv.includes("--check")) {
  const committed = existsSync(OUT) ? readFileSync(OUT, "utf8").replace(/\r\n/g, "\n") : null;
  if (committed !== out) {
    console.error("gen-screendef-snapshots --check FAILED: screendef-snapshots.test.tsx is out of sync with screen-defs/.");
    console.error("fix: node scripts/gen-screendef-snapshots.mjs  (never hand-edit generated tests)");
    process.exit(1);
  }
  console.log("gen-screendef-snapshots --check OK");
} else {
  writeFileSync(OUT, out, "utf8");
  console.log(`gen-screendef-snapshots OK: wrote ${OUT}`);
}
