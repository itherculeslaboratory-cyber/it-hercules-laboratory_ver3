// V3-UIX-05 — ScreenDef structural discipline. checkStructure detects each
// violation (>3 sections, >3 cards, dead-end, >3-line text); every cluster-owned
// real screen-def passes.
import { describe, expect, it } from "vitest";
import { checkStructure, runGate, CLUSTER_OWNED, flattenNodes } from "../scripts/check-screendef-structure.mjs";
import { loadScreenDefs } from "../scripts/check-navigation.mjs";
import { fileURLToPath } from "node:url";

// vitest runs with cwd = tests/, so the gate's cwd default is wrong here — the
// scripts read screen-defs/ relative to the repo root, which is tests/..
const ROOT = fileURLToPath(new URL("..", import.meta.url));

type Node = { id: string; type: string; props?: Record<string, unknown>; action?: unknown; children?: Node[] };
const def = (nodes: Node[], extra: Record<string, unknown> = {}) => ({
  screen_id: "t",
  route: "/t",
  title: "t",
  nodes,
  ...extra,
});
const forwardLink: Node = { id: "next", type: "link", props: { href: "/", next_step: "戻る" } };

describe("V3-UIX-05 checkStructure", () => {
  it("flags more than 3 section nodes", () => {
    const bad = def([...[1, 2, 3, 4].map((i) => ({ id: `s${i}`, type: "section" })), forwardLink]);
    expect(checkStructure(bad).some((m) => m.includes("too many sections"))).toBe(true);
  });

  it("flags more than 3 card nodes", () => {
    const bad = def([...[1, 2, 3, 4].map((i) => ({ id: `c${i}`, type: "card" })), forwardLink]);
    expect(checkStructure(bad).some((m) => m.includes("too many cards"))).toBe(true);
  });

  it("flags a dead-end screen (no transition/navigate/link/next_step)", () => {
    const bad = def([{ id: "h", type: "heading", props: { text: "だけ" } }]);
    expect(checkStructure(bad).some((m) => m.includes("no forward affordance"))).toBe(true);
  });

  it("flags a text node longer than 3 lines", () => {
    const bad = def([{ id: "t", type: "text", props: { text: "a\nb\nc\nd" } }, forwardLink]);
    expect(checkStructure(bad).some((m) => m.includes("text over"))).toBe(true);
  });

  it("accepts a well-formed screen (3 cards, forward affordance, short text)", () => {
    const ok = def([
      { id: "c1", type: "card" },
      { id: "c2", type: "card" },
      { id: "c3", type: "card" },
      { id: "t", type: "text", props: { text: "一行\n二行" } },
      forwardLink,
    ]);
    expect(checkStructure(ok)).toEqual([]);
  });

  it("every cluster-owned screen-def passes (real defs)", () => {
    const dir = fileURLToPath(new URL("../screen-defs", import.meta.url));
    const byId = new Map(loadScreenDefs(dir).map((d) => [d.screen_id, d]));
    for (const id of CLUSTER_OWNED) {
      const d = byId.get(id);
      expect(d, `${id} present`).toBeTruthy();
      expect(checkStructure(d), `${id} structure`).toEqual([]);
      // sanity: flatten reaches nested children
      expect(flattenNodes(d).length).toBeGreaterThan(0);
    }
    expect(runGate(ROOT)).toEqual([]);
  });
});
