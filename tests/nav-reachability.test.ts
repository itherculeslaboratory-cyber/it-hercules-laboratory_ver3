// V3-UIX-02 / V3-UIX-25 — navigation reachability. Build the real screen graph
// from every screen-def's transitions[] + navigate actions + link hrefs, BFS from
// home, and assert the K4-owned destinations are not buried.
//
// Reachability budgets (design-k4 §3, critic fix (4) — real screen_ids only):
//   settings / theme-gallery / ui-templates : ≤3 clicks from home (they are direct
//     links off home = 1 click).
//   obs-detail (観測保存の着地) : ≤3 — home の主ボタンは obs-entry 直行
//     (obs-entry が domain を自前収集するため domain-select ホップは保存動線では冗長。
//     ガイド選択は home の別リンクで維持)。home→obs-entry→obs-confirm→obs-detail = 3。
//     market/gmo/lottery have no screen-def
//     in this cluster and are NOT targets (each cluster validates its own).
import { describe, expect, it } from "vitest";
import { loadScreenDefs } from "../scripts/check-navigation.mjs";
import { fileURLToPath } from "node:url";

type Node = {
  type?: string;
  action?: { kind?: string; to?: string };
  props?: { href?: string };
  children?: Node[];
};
type Def = { screen_id: string; nodes?: Node[]; transitions?: { to_screen_id: string }[] };

const dir = fileURLToPath(new URL("../screen-defs", import.meta.url));
const defs = loadScreenDefs(dir) as Def[];

// A navigate/link target -> the destination screen_id ("" = not a screen link).
function toScreenId(target: string | undefined): string {
  if (!target) return "";
  const t = target.split("?")[0]; // drop query (obs-entry?domain=biology)
  if (t === "/") return "home";
  const m = t.match(/^\/s\/([a-z0-9-]+)/); // /s/<id> app link
  return m ? m[1] : t; // bare navigate targets are already screen_ids
}

/** Out-edges of one screen-def: transitions + navigate actions + app links. */
function edgesOf(def: Def): Set<string> {
  const out = new Set<string>();
  for (const t of def.transitions ?? []) out.add(t.to_screen_id);
  const visit = (n: Node) => {
    if (n.action?.kind === "navigate") out.add(toScreenId(n.action.to));
    if (n.type === "link" && n.props?.href) out.add(toScreenId(n.props.href));
    for (const c of n.children ?? []) visit(c);
  };
  for (const n of def.nodes ?? []) visit(n);
  out.delete("");
  return out;
}

/** BFS click-distance from home to every reachable screen_id. */
function distancesFromHome(): Map<string, number> {
  const graph = new Map(defs.map((d) => [d.screen_id, edgesOf(d)]));
  const dist = new Map<string, number>([["home", 0]]);
  const queue = ["home"];
  while (queue.length) {
    const cur = queue.shift()!;
    const d = dist.get(cur)!;
    for (const next of graph.get(cur) ?? []) {
      if (!dist.has(next)) {
        dist.set(next, d + 1);
        queue.push(next);
      }
    }
  }
  return dist;
}

const TARGETS: Record<string, number> = {
  settings: 3,
  "theme-gallery": 3,
  "ui-templates": 3,
  "obs-detail": 3,
};

describe("V3-UIX-02/25 navigation reachability from home", () => {
  const dist = distancesFromHome();

  it("home exists and is the BFS root", () => {
    expect(defs.some((d) => d.screen_id === "home")).toBe(true);
    expect(dist.get("home")).toBe(0);
  });

  it("every K4 destination is reachable within its click budget (超過 0)", () => {
    for (const [id, budget] of Object.entries(TARGETS)) {
      const d = dist.get(id);
      expect(d, `${id} reachable from home`).toBeTypeOf("number");
      expect(d!, `${id} within ${budget} clicks`).toBeLessThanOrEqual(budget);
    }
  });

  it("the three settings-family destinations are direct (≤3, actually 1 click)", () => {
    for (const id of ["settings", "theme-gallery", "ui-templates"]) {
      expect(dist.get(id), id).toBeLessThanOrEqual(3);
    }
  });

  it("obs-detail is reached via the OBS-25 confirm flow within 3 clicks", () => {
    // home → obs-entry → obs-confirm → obs-detail (domain-select はガイド用の並行導線)
    expect(dist.get("obs-domain-select")).toBe(1);
    expect(dist.get("obs-entry")).toBe(1);
    expect(dist.get("obs-confirm")).toBe(2);
    expect(dist.get("obs-detail")).toBe(3);
  });
});
