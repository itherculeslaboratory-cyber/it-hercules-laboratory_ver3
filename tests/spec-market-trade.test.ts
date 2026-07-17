// V3-AIP-34 — Spec-Driven design contract, applied to a second domain
// (market-trade) after tests/spec-thread.test.ts proved the pattern on the
// 知の広場 thread screen. Same discipline, same 3 checks: (1) the screen-def
// validates against screendef.schema.json, (2) every API endpoint it
// reads/writes is deny-by-default (401 without auth — cl-04-route-matrix
// pattern, driving the real app), (3) the screen is reachable in
// navigation.json. Discovered structurally (route/screen_id/API references),
// not hardcoded to a filename, so it stays wired if market-trade.json is ever
// renamed or the market flow is later split across screens.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import app from "../apps/api/src/index";
import { makeEnv } from "./helpers";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(fileURLToPath(new URL("../package.json", import.meta.url)));

type Node = { id: string; type: string; props?: Record<string, unknown>; action?: Record<string, unknown>; children?: Node[] };
type ScreenDef = { screen_id: string; route: string; title: string; nodes: Node[] };

function flatten(def: ScreenDef): Node[] {
  const out: Node[] = [];
  const walk = (n: Node) => {
    out.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  for (const n of def.nodes ?? []) walk(n);
  return out;
}

// A "market-trade spec" = the 出品/取引 screen (draft→publish→match→pay→ship→
// receive). Discovered structurally: route/screen_id naming, or any node
// reading/writing /market/listings.
function referencesMarketListings(def: ScreenDef): boolean {
  return flatten(def).some((n) => {
    const src = typeof n.props?.source_path === "string" ? n.props.source_path : "";
    const act = n.action?.kind === "api" && typeof n.action.path === "string" ? n.action.path : "";
    return /\/market\/listings/.test(src + " " + act);
  });
}
function findMarketTradeSpec(): ScreenDef | null {
  const dir = `${ROOT}/screen-defs`;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    let def: ScreenDef;
    try {
      def = JSON.parse(readFileSync(`${dir}/${name}`, "utf8"));
    } catch {
      continue;
    }
    const route = def.route ?? "";
    const id = def.screen_id ?? "";
    if (/\/market\/trade/.test(route) || /market-?trade/i.test(id)) return def;
    if (referencesMarketListings(def)) return def;
  }
  return null;
}

// Every API endpoint the screen reads (list source_path) or writes (form/button
// api action), as {method, path}. {param}/{{...}}/:param → "x" so the path is
// requestable against the real app.
function apiEndpoints(def: ScreenDef): { method: string; path: string }[] {
  const out = new Map<string, { method: string; path: string }>();
  const concrete = (p: string) => p.replace(/\{\{[^{}]*\}\}|\{[^{}]*\}/g, "x").replace(/:[^/]+/g, "x");
  for (const n of flatten(def)) {
    const src = n.props?.source_path;
    if (typeof src === "string" && src.startsWith("/api/")) out.set("GET " + src, { method: "GET", path: concrete(src) });
    if (n.action && n.action.kind === "api" && typeof n.action.path === "string") {
      const m = (typeof n.action.method === "string" ? n.action.method : "POST").toUpperCase();
      out.set(m + " " + n.action.path, { method: m, path: concrete(n.action.path as string) });
    }
  }
  return [...out.values()];
}

const marketTradeSpec = findMarketTradeSpec();

if (!marketTradeSpec) {
  // eslint-disable-next-line no-console
  console.warn(
    "[STOP] spec-market-trade.test.ts skipped: market-trade screen-def not found " +
      "(V3-AIP-34 2nd-domain Spec-Driven contract). Validation + route-matrix integrity " +
      "wire automatically once a screen reading/writing /market/listings lands in screen-defs/.",
  );
}

describe.skipIf(!marketTradeSpec)("V3-AIP-34 market-trade spec (Spec-Driven contract, 2nd domain)", () => {
  const def = marketTradeSpec!;

  it("validates against screendef.schema.json (draft 2020-12)", () => {
    const Ajv2020 = require("ajv/dist/2020.js");
    const ajv = new (Ajv2020.default ?? Ajv2020)({ allErrors: true, strict: false });
    const schema = JSON.parse(readFileSync(`${ROOT}/schemas/screendef/screendef.schema.json`, "utf8"));
    const validate = ajv.compile(schema);
    expect(validate(def), JSON.stringify(validate.errors)).toBe(true);
  });

  it("every API endpoint the market-trade screen touches is deny-by-default (401 without auth)", async () => {
    const endpoints = apiEndpoints(def);
    expect(endpoints.length, "market-trade screen must read/write at least one API route").toBeGreaterThan(0);
    for (const e of endpoints) {
      const res = await app.request(e.path, { method: e.method }, makeEnv());
      expect(res.status, `${e.method} ${e.path}`).toBe(401);
      expect(await res.json()).toEqual({ error: "AUTH_REQUIRED" });
    }
  });

  it("the market-trade screen is reachable in navigation.json", () => {
    const nav = JSON.parse(readFileSync(`${ROOT}/screen-defs/navigation.json`, "utf8")) as {
      screens?: string[];
      nodes?: string[];
      edges?: { from: string; to: string }[];
    };
    const referenced =
      (nav.screens ?? nav.nodes ?? []).includes(def.screen_id) ||
      (nav.edges ?? []).some((e) => e.to === def.screen_id || e.from === def.screen_id);
    expect(referenced, `${def.screen_id} must appear in navigation.json (reachability)`).toBe(true);
  });
});
