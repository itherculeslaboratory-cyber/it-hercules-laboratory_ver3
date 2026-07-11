// V3-AUT-11 — navigation structure GATE. checkNavigation rejects broken
// structure, dangling edges, and missing screendef-transition edges; the real
// screen-defs/navigation.json validates against the real ScreenDef set.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkNavigation, loadScreenDefs } from "../scripts/check-navigation.mjs";

const DEFS = [
  { screen_id: "login", transitions: [{ to_screen_id: "home" }] },
  { screen_id: "home", transitions: [] },
];
const okNav = () => ({
  entry: "login",
  screens: ["login", "home"],
  edges: [{ from: "login", to: "home", label: "x" }],
});

describe("V3-AUT-11 checkNavigation(structure + completeness)", () => {
  it("passes a well-formed navigation over its screendefs", () => {
    expect(checkNavigation(okNav(), DEFS)).toEqual([]);
  });

  it("fails when entry is missing (structure)", () => {
    const nav = okNav() as any;
    delete nav.entry;
    expect(checkNavigation(nav, DEFS).length).toBeGreaterThan(0);
  });

  it("fails when edges is not an array (structure)", () => {
    const nav = { ...okNav(), edges: "nope" } as any;
    expect(checkNavigation(nav, DEFS).length).toBeGreaterThan(0);
  });

  it("fails on a dangling edge that references an unknown screen", () => {
    const nav = okNav();
    nav.edges.push({ from: "login", to: "ghost", label: "x" });
    const v = checkNavigation(nav, DEFS);
    expect(v.some((m) => m.includes("ghost"))).toBe(true);
  });

  it("fails when a screendef transition has no matching edge", () => {
    const nav = okNav();
    nav.edges = []; // drop login->home edge that the login screendef declares
    const v = checkNavigation(nav, DEFS);
    expect(v.some((m) => m.includes("login -> home"))).toBe(true);
  });

  it("fails when entry is not a listed screen", () => {
    const nav = { ...okNav(), entry: "nowhere" };
    expect(checkNavigation(nav, DEFS).some((m) => m.includes("entry not a screen"))).toBe(true);
  });

  it("the real screen-defs/navigation.json is valid against the real screendefs", () => {
    const dir = fileURLToPath(new URL("../screen-defs", import.meta.url));
    const nav = JSON.parse(readFileSync(`${dir}/navigation.json`, "utf8"));
    expect(checkNavigation(nav, loadScreenDefs(dir))).toEqual([]);
  });
});
