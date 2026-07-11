#!/usr/bin/env node
// GATE: dependency-direction + nested-npm + wrangler-binding denylist (V3-FND-12 / V3-FND-02).
// Enforces the DAG in docs/architecture.md and invariant ① (no resident DB as SSOT):
//   D1  apps → apps          FAIL (one app importing another app)
//   D2  {packages,libs,components} → apps   FAIL
//   D3  any `shared/` layer import          FAIL
//   nested-npm : a tracked package.json outside root / a workspace root      FAIL
//   binding    : d1_databases|kv_namespaces|durable_objects|hyperdrive in
//                apps/api/wrangler.toml (resident stores) FAIL — R2 bucket stays green
// `tests/` may import apps (test harness) and is exempt from D1/D2.
// Pure helpers (checkImport / isNestedPkg / scanBindings) are exported for --selftest.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { posix } from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const APP_LAYER = "apps";
const NONAPP_TO_APP = new Set(["packages", "libs", "components"]);
const SRC_EXT = /\.(ts|tsx|mjs|cjs|js)$/;
const IMPORT_RE = /\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
const BINDING_DENY = /\b(d1_databases|kv_namespaces|durable_objects|hyperdrive)\b/g;

/** Repo-relative posix path → {layer, owner}. owner = top two segments for known layers. */
function topInfo(rel) {
  const seg = rel.split("/");
  const layer = seg[0];
  const owner =
    layer === APP_LAYER || NONAPP_TO_APP.has(layer) ? `${seg[0]}/${seg[1]}` : null;
  return { layer, owner };
}

/** Resolve an import specifier to {layer, owner} in this repo, or null if external. */
function resolveTarget(sourceRel, spec, wsMap) {
  if (spec.startsWith(".")) {
    const t = posix.normalize(posix.join(posix.dirname(sourceRel), spec));
    return topInfo(t);
  }
  if (spec.startsWith("@ihl/")) {
    const owner = wsMap.get(spec);
    return owner ? topInfo(owner) : null;
  }
  return null; // external module (react, node:*, @/… alias, etc.)
}

/**
 * Return a violation reason for one import, or null if allowed.
 * Pure — depends only on the two strings + workspace name map.
 */
export function checkImport(sourceRel, spec, wsMap) {
  if (spec.split("/").includes("shared"))
    return `D3 shared-layer import: ${sourceRel} → "${spec}"`;
  const target = resolveTarget(sourceRel, spec, wsMap);
  if (!target || target.layer !== APP_LAYER) {
    // not an app target → only D3 applies (handled above)
    if (!target) return null;
  }
  const src = topInfo(sourceRel);
  if (target.layer === APP_LAYER) {
    if (src.layer === APP_LAYER && target.owner !== src.owner)
      return `D1 apps→apps: ${sourceRel} → "${spec}"`;
    if (NONAPP_TO_APP.has(src.layer))
      return `D2 ${src.layer}→apps: ${sourceRel} → "${spec}"`;
  }
  return null;
}

/** A tracked package.json is nested unless it is root or a direct workspace root. */
export function isNestedPkg(rel) {
  if (!rel.endsWith("package.json")) return false;
  if (rel === "package.json") return false;
  return !/^(apps|packages)\/[^/]+\/package\.json$/.test(rel) && rel !== "tests/package.json";
}

/** Resident-store bindings found in a wrangler.toml body (empty = clean). */
export function scanBindings(tomlText) {
  return [...tomlText.matchAll(BINDING_DENY)].map((m) => m[1]);
}

function trackedFiles(root) {
  return execSync("git ls-files", { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

/** Build @ihl/<name> → "apps/<name>" | "packages/<name>" map from workspace manifests. */
function workspaceMap(root, tracked) {
  const map = new Map();
  for (const rel of tracked) {
    if (!/^(apps|packages)\/[^/]+\/package\.json$/.test(rel)) continue;
    try {
      const name = JSON.parse(readFileSync(join(root, rel), "utf8")).name;
      if (name) map.set(name, rel.replace(/\/package\.json$/, ""));
    } catch {
      /* ignore unparsable manifest */
    }
  }
  return map;
}

function runGate() {
  const root = process.cwd();
  const tracked = trackedFiles(root);
  const wsMap = workspaceMap(root, tracked);
  const violations = [];

  // 1. import direction
  for (const rel of tracked) {
    if (!SRC_EXT.test(rel) || rel.includes("/generated/")) continue;
    const text = readFileSync(join(root, rel), "utf8");
    for (const m of text.matchAll(IMPORT_RE)) {
      const v = checkImport(rel, m[1], wsMap);
      if (v) violations.push(v);
    }
  }

  // 2. nested npm
  for (const rel of tracked) if (isNestedPkg(rel)) violations.push(`nested npm: ${rel}`);

  // 3. wrangler binding denylist
  const wrangler = "apps/api/wrangler.toml";
  if (existsSync(join(root, wrangler)))
    for (const b of scanBindings(readFileSync(join(root, wrangler), "utf8")))
      violations.push(`resident-store binding (invariant ①): ${wrangler} [[${b}]]`);

  return violations;
}

function selftest() {
  const ok = [];
  const assert = (cond, label) => {
    ok.push(`${cond ? "PASS" : "FAIL"}  ${label}`);
    if (!cond) process.exitCode = 1;
  };
  const ws = new Map([
    ["@ihl/api", "apps/api"],
    ["@ihl/web", "apps/web"],
    ["@ihl/truth", "packages/truth"],
  ]);
  // known-bad → must flag
  assert(!!checkImport("apps/web/src/p.ts", "@ihl/api", ws), "D1 apps→apps (pkg name)");
  assert(!!checkImport("apps/web/src/p.ts", "../../api/src/index", ws), "D1 apps→apps (relative)");
  assert(!!checkImport("packages/truth/src/x.ts", "@ihl/api", ws), "D2 packages→apps");
  assert(!!checkImport("libs/vision/index.ts", "@ihl/api", ws), "D2 libs→apps");
  assert(!!checkImport("components/x/run.ts", "../../apps/api/src/index", ws), "D2 components→apps");
  assert(!!checkImport("apps/api/src/x.ts", "./shared/util", ws), "D3 shared (relative)");
  assert(!!checkImport("apps/api/src/x.ts", "@ihl/shared", ws), "D3 shared (pkg name)");
  assert(scanBindings("[[d1_databases]]").length > 0, "binding d1 flagged");
  assert(scanBindings("kv_namespaces = []").length > 0, "binding kv flagged");
  assert(isNestedPkg("apps/api/src/sub/package.json"), "nested pkg deep");
  assert(isNestedPkg("components/collector-switchbot/package.json"), "nested pkg in components");
  // known-good → must NOT flag
  assert(!checkImport("apps/api/src/index.ts", "./auth-routes", ws), "intra-app relative ok");
  assert(!checkImport("apps/api/src/x.ts", "@ihl/truth", ws), "apps→packages ok");
  assert(!checkImport("apps/api/src/x.ts", "../../../config/foo.json", ws), "apps→repo-root ok");
  assert(!checkImport("apps/web/src/p.ts", "@/lib/api", ws), "@/ alias ignored");
  assert(!checkImport("tests/x.test.ts", "../apps/api/src/index", ws), "tests→apps exempt");
  assert(!checkImport("packages/truth/src/x.ts", "./contracts", ws), "intra-pkg relative ok");
  assert(scanBindings("[[r2_buckets]]\nbinding = \"TRUTH\"").length === 0, "r2 bucket clean");
  assert(!isNestedPkg("apps/api/package.json"), "workspace root pkg ok");
  assert(!isNestedPkg("tests/package.json"), "tests root pkg ok");
  for (const line of ok) console.log("  " + line);
  if (process.exitCode) console.error("lint-deps --selftest FAILED");
  else console.log("lint-deps --selftest OK");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (process.argv.includes("--selftest")) {
    selftest();
  } else {
    const violations = runGate();
    if (violations.length) {
      console.error("dep lint FAILED:");
      for (const v of violations) console.error("  - " + v);
      process.exit(1);
    }
    console.log("dep lint OK");
  }
}
