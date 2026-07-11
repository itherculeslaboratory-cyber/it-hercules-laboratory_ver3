// V3-BBS-01 — 知の広場 screendef 群 (design-c5.md §K6 §2.4).
//   (1) knowledge-hub は3柱カードのみ: card ノード3枚・それぞれ navigate action で
//       {knowledge-board, knowledge-paper, knowledge-github} へ。button/list/form/field
//       等の重複ナビ面（＝タブ/カード重複）を持たない（BBS-01 タブとカードの重複禁止）。
//   (2) home→hub→各柱主要操作が navigation.json のエッジ上 ≤3 クリック。
//   (3) 4 screendef が screendef.schema.json (draft 2020-12) に妥当。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { flattenNodes } from "../scripts/check-screendef-structure.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));

const PILLARS = ["knowledge-board", "knowledge-paper", "knowledge-github"] as const;
const KNOWLEDGE_SCREENS = ["knowledge-hub", ...PILLARS] as const;

const hub = read("../screen-defs/knowledge-hub.json");
const nav = read("../screen-defs/navigation.json");

// BFS shortest hop count from `start` over navigation.json directed edges.
function clicks(start: string, target: string): number {
  const adj = new Map<string, string[]>();
  for (const e of nav.edges) (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e.to);
  const seen = new Set([start]);
  let frontier = [start];
  let dist = 0;
  while (frontier.length) {
    if (frontier.includes(target)) return dist;
    const next: string[] = [];
    for (const n of frontier)
      for (const to of adj.get(n) ?? [])
        if (!seen.has(to)) { seen.add(to); next.push(to); }
    frontier = next;
    dist++;
  }
  return Infinity;
}

describe("V3-BBS-01 知の広場 screendefs", () => {
  it("knowledge-hub is exactly 3 pillar cards, no duplicate nav surface (tab/card 重複禁止)", () => {
    const nodes = flattenNodes(hub);
    const cards = nodes.filter((n: any) => n.type === "card");
    expect(cards.length).toBe(3);
    // No tab-like / duplicate navigation affordance beside the 3 cards.
    for (const t of ["button", "list", "form", "field", "tab", "qr-code"])
      expect(nodes.some((n: any) => n.type === t), `hub must not contain ${t}`).toBe(false);
    // Every pillar card navigates, and the 3 targets are exactly the 3 pillars.
    const targets = cards.map((c: any) => {
      expect(c.action?.kind, `${c.id} action`).toBe("navigate");
      return c.action.to;
    });
    expect([...targets].sort()).toEqual([...PILLARS].sort());
    // hub declares a transition per pillar card.
    expect((hub.transitions ?? []).map((t: any) => t.to_screen_id).sort()).toEqual([...PILLARS].sort());
  });

  it("home → hub → each pillar's main operation is ≤3 clicks", () => {
    expect(clicks("home", "knowledge-hub")).toBe(1);
    for (const p of PILLARS) expect(clicks("home", p), `home→${p}`).toBeLessThanOrEqual(3);
    // 柱2 主要操作 = 論文照合 (paper-match): home→hub→paper→paper-match = 3.
    expect(clicks("home", "paper-match")).toBeLessThanOrEqual(3);
  });

  it("all 4 knowledge screendefs validate against screendef.schema.json", () => {
    const require = createRequire(fileURLToPath(new URL("../package.json", import.meta.url)));
    const Ajv2020 = require("ajv/dist/2020.js");
    const ajv = new (Ajv2020.default ?? Ajv2020)({ allErrors: true, strict: false });
    const schema = JSON.parse(readFileSync(`${ROOT}/schemas/screendef/screendef.schema.json`, "utf8"));
    const validate = ajv.compile(schema);
    for (const id of KNOWLEDGE_SCREENS) {
      const def = read(`../screen-defs/${id}.json`);
      const ok = validate(def);
      expect(ok, `${id}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });
});
