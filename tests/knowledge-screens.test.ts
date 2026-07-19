// V3-BBS-01 — 知の広場 screendef 群 (design-c5.md §K6 §2.4).
//   (1) knowledge-hub Stage1(KNW wave1・承認済み再設計 R94/R107): 単一の list ノード
//       (variant=knowledge-hub・source_path=/api/v1/plaza/search)へ一本化。旧「3柱カード
//       (board/paper/github)」構成はユーザー30点評価を受け撤去済み。3モード入口(困った/
//       話したい/論文)+重複防止検索は KnowledgeHubNode コンポーネント側で描画し、screen-def
//       は単一ノードに保つ(renderer-knw-search.test.tsx 等が挙動を検証)。
//   (2) home→hub→各柱主要操作が navigation.json のエッジ上 ≤3 クリック(ナビ到達性は不変)。
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
  it("knowledge-hub Stage1 = 単一の list ノード(variant=knowledge-hub・3モード入口)。旧3柱カードは KNW wave1 で撤去(承認済み再設計)", () => {
    const nodes = flattenNodes(hub);
    // 旧: 3柱カード → 新(KNW wave1 stage1・R94/R107承認): カード無し・KnowledgeHubNode に一本化。
    const cards = nodes.filter((n: any) => n.type === "card");
    expect(cards.length).toBe(0);
    // content ノードは knowledge-hub variant の list ちょうど1個(3モード入口+検索はコンポーネント側)。
    const lists = nodes.filter((n: any) => n.type === "list");
    expect(lists.length).toBe(1);
    expect(lists[0].props?.variant).toBe("knowledge-hub");
    expect(lists[0].props?.source_path).toBe("/api/v1/plaza/search");
    // 旧「タブとカードの重複」禁止の精神は維持: screen-def 直下に重複ナビ面(button/form/field/tab/qr-code)を置かない。
    for (const t of ["button", "form", "field", "tab", "qr-code"])
      expect(nodes.some((n: any) => n.type === t), `hub must not contain ${t}`).toBe(false);
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
