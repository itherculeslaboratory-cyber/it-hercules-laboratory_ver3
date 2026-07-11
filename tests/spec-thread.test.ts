// V3-AIP-34 — Spec-Driven design contract for the 知の広場 thread screen.
// The thread spec (K6 正本) must (1) validate against screendef.schema.json and
// (2) be consistent with the route matrix: every API path the thread screen
// reads/writes is a PROTECTED route (deny-by-default), and the screen is
// reachable in navigation.json. Same discipline cl-04-route-matrix pins for the
// whole API — here for one Spec-first screen.
//
// DEPENDENCY GATE (design-k8 §5): the thread spec is a K6 deliverable and is
// still 未明文化 (c5-cluster-table V3-AIP-34). Until K6 publishes a thread-view
// screen-def this suite SKIPS and reports the stop — symmetric with
// apps/web/e2e/{market,ledger}.spec.ts. It activates automatically the moment a
// thread screen-def appears in screen-defs/.
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

// A "thread spec" = a screen-def that renders a SINGLE thread: its route carries
// a thread id parameter (…/t/{thread_id} per citeUrl, or a :thread_id / {thread_id}
// segment) or its screen_id names a thread. Discovered structurally so it wires
// to whatever K6 names the file.
function findThreadSpec(): ScreenDef | null {
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
    if (/\{thread_id\}|:thread_id|\/t\//.test(route) || /thread/i.test(id)) return def;
  }
  return null;
}

function flatten(def: ScreenDef): Node[] {
  const out: Node[] = [];
  const walk = (n: Node) => {
    out.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  for (const n of def.nodes ?? []) walk(n);
  return out;
}

// Every API endpoint the screen reads (list source_path) or writes (form api
// action), as {method, path}. {param}/:param → "x" so the path is requestable.
function apiEndpoints(def: ScreenDef): { method: string; path: string }[] {
  const out = new Map<string, { method: string; path: string }>();
  const concrete = (p: string) => p.replace(/\{[^}]+\}/g, "x").replace(/:[^/]+/g, "x");
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

const threadSpec = findThreadSpec();

if (!threadSpec) {
  // eslint-disable-next-line no-console
  console.warn(
    "[STOP] spec-thread.test.ts skipped: K6 知の広場 thread screen-def not produced yet " +
      "(V3-AIP-34 spec JSON 未明文化, design-k8 §5). Validation + route-matrix integrity " +
      "wire automatically once a thread-view screen-def lands in screen-defs/.",
  );
}

describe.skipIf(!threadSpec)("V3-AIP-34 thread spec (Spec-Driven contract)", () => {
  const def = threadSpec!;

  it("validates against screendef.schema.json (draft 2020-12)", () => {
    const Ajv2020 = require("ajv/dist/2020.js");
    const ajv = new (Ajv2020.default ?? Ajv2020)({ allErrors: true, strict: false });
    const schema = JSON.parse(readFileSync(`${ROOT}/schemas/screendef/screendef.schema.json`, "utf8"));
    const validate = ajv.compile(schema);
    expect(validate(def), JSON.stringify(validate.errors)).toBe(true);
  });

  it("every API endpoint the thread screen touches is deny-by-default (401 without auth)", async () => {
    // cl-04-route-matrix pattern: drive the REAL app. Thread content is
    // protected, so each endpoint the screen reads/writes must gate to
    // 401 AUTH_REQUIRED before routing — authoritative over any CSV label.
    const endpoints = apiEndpoints(def);
    expect(endpoints.length, "thread screen must read/write at least one API route").toBeGreaterThan(0);
    for (const e of endpoints) {
      const res = await app.request(e.path, { method: e.method }, makeEnv());
      expect(res.status, `${e.method} ${e.path}`).toBe(401);
      expect(await res.json()).toEqual({ error: "AUTH_REQUIRED" });
    }
  });

  it("the thread screen is reachable in navigation.json", () => {
    const nav = JSON.parse(readFileSync(`${ROOT}/screen-defs/navigation.json`, "utf8")) as {
      nodes?: string[];
      edges?: { from: string; to: string }[];
    };
    const referenced =
      (nav.nodes ?? []).includes(def.screen_id) ||
      (nav.edges ?? []).some((e) => e.to === def.screen_id || e.from === def.screen_id);
    expect(referenced, `${def.screen_id} must appear in navigation.json (reachability)`).toBe(true);
  });
});
