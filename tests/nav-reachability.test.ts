// V3-UIX-02 / V3-UIX-25 — navigation reachability. Build the screen graph from
// screen-defs/navigation.json (the rendering-independent flow-spec正本 —
// V3-UIX-36裁定, ihl-ver2\docs\planning\ver3\ver3-裁定記録-2026-07-10.md:59),
// BFS from home, and assert the click/step budgets from CLICKBUDGET-1.
//
// ★2026-08-01是正(CLICKBUDGET-1○90点・R0801-4c1b9f-REPORT-2026-08-01-g81-clickthink.md
// §5-C1/C3の履行。カード=review-queue\R0801-4c1b9f-clickbudget-2026-08-01.json):
//   計測正本を screen-defs BFS(旧M1)から navigation.json BFS(M2)へ切り替えた。
//   理由: navigation.json は V3-UIX-36裁定が「遷移仕様の正本」と定めたファイルであり、
//   screen-defs BFS は home の deep_link/drawer/検索結果ナビ等(renderer.tsx側の
//   実装のみに存在する辺)を見ておらず、実アプリより悲観的な数字が出ていた
//   (旧計測=到達不能27/55)。navigation.json の各 edge には
//   source: "screendef" | "renderer" | "planned" が付与済み(check-navigation.mjs
//   が構造検査)。BFS は source:"planned"(宣言のみ・実体なし)の辺を除外する
//   ——これが旧テストの「古い辺(home→obs-navigator等)を機械で辿ってしまう」事故の
//   再発防止。
//
//   契約(旧: obs-detail 通し3クリック・単一予算)を2本立てへ分割:
//     到達予算(reach budget) = home から「主要行為を開始できる画面」まで。
//     完了予算(flow budget)  = 開始画面から確定(保存)までのステップ数。
//   対象外化: obs-detail(旧フローの着地画面)。理由=NAV-1(○85点cutover)により
//     観測登録の正本フローは obs-register→…→obs-register-done に移り、obs-detail は
//     obs-entry/obs-confirm という「もう主要導線ではない」旧フローの着地点になった。
//     E3導線(過去の観測を後から開く。IDEA候補・§8-2 in clickthink report)が実装され
//     obs-detail が再び主要導線に含まれたら、この対象外化を再評価すること。
//   撤去: toBe(5) の完全一致アサーション(カードifNo欄に明記の既知の罠——実測値を
//     そのままテストへ焼くと、裁定を経ずに契約が緩んだことを機械が追認してしまう。
//     上限(≤)へ置き換える)。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Edge = { from: string; to: string; source: "screendef" | "renderer" | "planned" };
type Nav = { entry: string; screens: string[]; edges: Edge[] };

const navPath = fileURLToPath(new URL("../screen-defs/navigation.json", import.meta.url));
const nav = JSON.parse(readFileSync(navPath, "utf8")) as Nav;

/** BFS click-distance from home to every reachable screen_id, over navigation.json
 *  edges only (source:"planned" edges are declared-only and excluded — see header). */
function distancesFromHome(): Map<string, number> {
  const graph = new Map<string, string[]>();
  for (const e of nav.edges) {
    if (e.source === "planned") continue;
    if (!graph.has(e.from)) graph.set(e.from, []);
    graph.get(e.from)!.push(e.to);
  }
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

// 到達予算(reach budget) — home から「主要行為を開始できる画面」まで(§5-C2/C3)。
const REACH_TARGETS: Record<string, number> = {
  "obs-register": 1,
  "market-trade": 1,
  "obs-search": 3,
  "knowledge-hub": 3,
  settings: 3,
};

describe("V3-UIX-02/25 navigation reachability from home (navigation.json正本)", () => {
  const dist = distancesFromHome();

  it("home exists and is the BFS root", () => {
    expect(nav.screens.includes("home")).toBe(true);
    expect(dist.get("home")).toBe(0);
  });

  it("every reach-budget destination is reachable within its click budget (超過 0)", () => {
    for (const [id, budget] of Object.entries(REACH_TARGETS)) {
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

  // 完了予算(flow budget) — 開始画面(obs-register-entry)から確定(obs-register-done)
  // まで ≤2 ステップ(§5-C2/C3)。obs-register 自体は到達予算の対象なのでここでは
  // 「開始画面からの相対ホップ」を別グラフで測る(homeからの絶対距離ではない)。
  it("the observation-register flow completes within its step budget (entry -> done ≤2 hops)", () => {
    const graph = new Map<string, string[]>();
    for (const e of nav.edges) {
      if (e.source === "planned") continue;
      if (!graph.has(e.from)) graph.set(e.from, []);
      graph.get(e.from)!.push(e.to);
    }
    const flowDist = new Map<string, number>([["obs-register-entry", 0]]);
    const queue = ["obs-register-entry"];
    while (queue.length) {
      const cur = queue.shift()!;
      const d = flowDist.get(cur)!;
      for (const next of graph.get(cur) ?? []) {
        if (!flowDist.has(next)) {
          flowDist.set(next, d + 1);
          queue.push(next);
        }
      }
    }
    expect(flowDist.get("obs-register-done"), "obs-register-entry -> obs-register-done step count").toBeLessThanOrEqual(2);
  });
});
