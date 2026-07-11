#!/usr/bin/env node
// Phase C6 — 新旧 API 突合ハーネス (ver3 ↔ ver4 route reconciliation).
// Reads tests/fixtures/route-matrix.csv, and for every GET route drives BOTH the
// old and the new host and reports whether they agree (status + structural body
// diff with an envelope-variable whitelist).
//
// SAFETY: only GET is ever issued — POST/PATCH rows are dropped at extraction
// time (method !== "GET" filtered in getRoutes) so a mutating call can never
// happen from this tool. Requests run strictly serially so the legacy host is
// never load-spiked; each request has a 10s timeout and one retry.
//
// Pure helpers (parseRouteMatrix / getRoutes / resolvePath / diffJson /
// matchesWhitelist / compareRoute) are exported for the fixture-based TC — the
// TC injects a mock `fetch` via opts and never touches the network.
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL, fileURLToPath } from "node:url";

// Envelope values that legitimately vary between two live hosts — ignored by the
// structural diff. Override with --whitelist '<json array>'. Patterns match a
// leaf key OR a full dotted path; `*` is a wildcard.
export const DEFAULT_WHITELIST = [
  "id",
  "etag",
  "generated_at",
  "timestamp",
  "server_time",
  "request_id",
  "*_at", // created_at / updated_at / expires_at …
];

const VERDICTS = ["match", "diff", "old-only", "new-only", "skipped_param", "error"];

// ── CSV / route extraction ────────────────────────────────────────────────
/** Parse route-matrix.csv (skips `#` comment + blank lines) → array of row objects. */
export function parseRouteMatrix(csvText) {
  const lines = csvText
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "" && !l.startsWith("#"));
  if (lines.length === 0) return [];
  const header = lines[0].split(",");
  return lines.slice(1).map((l) => {
    const cols = l.split(",");
    const row = {};
    header.forEach((h, i) => (row[h] = cols[i] ?? ""));
    return row;
  });
}

/** GET routes only — this is the hard guard that no POST/PATCH is ever requested. */
export function getRoutes(rows) {
  return rows.filter((r) => r.method === "GET");
}

/**
 * Substitute `{param}` tokens in a path using `params`.
 * @returns {{ resolved: string|null, missing: string[] }} resolved=null when a
 *          required param is absent (→ caller records skipped_param).
 */
export function resolvePath(path, params = {}) {
  const missing = [];
  const resolved = path.replace(/\{([^}]+)\}/g, (_, name) => {
    if (params[name] == null) {
      missing.push(name);
      return `{${name}}`;
    }
    return encodeURIComponent(String(params[name]));
  });
  return { resolved: missing.length ? null : resolved, missing };
}

// ── structural JSON diff (whitelist-aware) ────────────────────────────────
const lastSeg = (p) => p.split(".").pop() ?? "";
const isPlainObject = (v) => v != null && typeof v === "object" && !Array.isArray(v);

function wildcardMatch(pattern, str) {
  const re = new RegExp(
    "^" + pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$",
  );
  return re.test(str);
}

/** True if `fullPath` (or its leaf key) is whitelisted as an envelope-variable value. */
export function matchesWhitelist(fullPath, key, whitelist) {
  return whitelist.some((p) => wildcardMatch(p, key) || wildcardMatch(p, fullPath));
}

/**
 * Recursive structural diff of two JSON values with a key-path whitelist.
 * @returns {Array<{path,kind,old?,new?}>} empty array === structurally equal.
 */
export function diffJson(a, b, whitelist = DEFAULT_WHITELIST, path = "") {
  if (path !== "" && matchesWhitelist(path, lastSeg(path), whitelist)) return [];

  if (Array.isArray(a) && Array.isArray(b)) {
    const out = [];
    if (a.length !== b.length)
      out.push({ path: path || "$", kind: "array-length", old: a.length, new: b.length });
    for (let i = 0; i < Math.min(a.length, b.length); i++)
      out.push(...diffJson(a[i], b[i], whitelist, `${path}[${i}]`));
    return out;
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const out = [];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const cp = path ? `${path}.${k}` : k;
      if (matchesWhitelist(cp, k, whitelist)) continue;
      if (!(k in a)) out.push({ path: cp, kind: "new-only-key", new: b[k] });
      else if (!(k in b)) out.push({ path: cp, kind: "old-only-key", old: a[k] });
      else out.push(...diffJson(a[k], b[k], whitelist, cp));
    }
    return out;
  }

  if (!Object.is(a, b)) return [{ path: path || "$", kind: "value", old: a, new: b }];
  return [];
}

// ── HTTP (GET only, timeout + 1 retry, serial) ────────────────────────────
async function getWithTimeout(url, headers, fetchFn, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { method: "GET", headers, signal: ctl.signal });
    const text = await res.text();
    let body;
    try {
      body = text === "" ? null : JSON.parse(text);
    } catch {
      body = text; // non-JSON — compared as a string leaf
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/** One GET with a single retry on failure. Throws the last error if both attempts fail. */
async function getOnce(url, headers, fetchFn, timeoutMs) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await getWithTimeout(url, headers, fetchFn, timeoutMs);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

const authHeaders = (val) => (val ? { authorization: val } : {});

/**
 * GET a single route on both hosts and compare.
 * @param {string} oldBase e.g. "https://old.example"
 * @param {string} newBase
 * @param {{method:string, path:string}} route — path must already be concrete.
 * @param {object} [opts] { authOld, authNew, whitelist, fetch, timeoutMs }
 * @returns {Promise<{status_old,status_new,status_match,body_diff,verdict,error?}>}
 */
export async function compareRoute(oldBase, newBase, route, opts = {}) {
  if (route.method !== "GET")
    return { status_old: null, status_new: null, status_match: false, body_diff: [], verdict: "error", error: `refusing non-GET method: ${route.method}` };

  const whitelist = opts.whitelist ?? DEFAULT_WHITELIST;
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;

  let oldRes, newRes;
  try {
    oldRes = await getOnce(oldBase + route.path, authHeaders(opts.authOld), fetchFn, timeoutMs);
    newRes = await getOnce(newBase + route.path, authHeaders(opts.authNew), fetchFn, timeoutMs);
  } catch (e) {
    return {
      status_old: oldRes?.status ?? null,
      status_new: newRes?.status ?? null,
      status_match: false,
      body_diff: [],
      verdict: "error",
      error: String(e?.message ?? e),
    };
  }

  const status_match = oldRes.status === newRes.status;
  // Both hosts gate the route (deny-by-default) → treat as a protected match; do
  // not diff the two 401 error envelopes.
  if (oldRes.status === 401 && newRes.status === 401)
    return { status_old: 401, status_new: 401, status_match: true, body_diff: [], verdict: "match" };

  const body_diff = diffJson(oldRes.body, newRes.body, whitelist);
  const o404 = oldRes.status === 404;
  const n404 = newRes.status === 404;
  let verdict;
  if (o404 && !n404) verdict = "new-only";
  else if (n404 && !o404) verdict = "old-only";
  else if (status_match && body_diff.length === 0) verdict = "match";
  else verdict = "diff";

  return { status_old: oldRes.status, status_new: newRes.status, status_match, body_diff, verdict };
}

// ── runner ────────────────────────────────────────────────────────────────
/** Reconcile every GET route in `csvText`, serially. Returns the report object. */
export async function reconcile(csvText, oldBase, newBase, opts = {}) {
  const params = opts.params ?? {};
  const routes = getRoutes(parseRouteMatrix(csvText));
  const results = [];
  for (const row of routes) {
    const { resolved, missing } = resolvePath(row.path, params);
    if (resolved === null) {
      results.push({ feature: row.feature, method: row.method, path: row.path, resolved_path: null, verdict: "skipped_param", missing });
      continue;
    }
    const cmp = await compareRoute(oldBase, newBase, { method: "GET", path: resolved }, opts);
    results.push({ feature: row.feature, method: row.method, path: row.path, resolved_path: resolved, ...cmp });
  }
  const totals = Object.fromEntries(VERDICTS.map((v) => [v, 0]));
  for (const r of results) totals[r.verdict]++;
  return {
    generated_at: new Date().toISOString(),
    old_base: oldBase,
    new_base: newBase,
    whitelist: opts.whitelist ?? DEFAULT_WHITELIST,
    totals,
    routes: results,
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────
const HELP = `reconcile-harness — Phase C6 新旧 API 突合ハーネス (GET routes only)

Usage:
  node scripts/reconcile-harness.mjs --old <base> --new <base> [options]

Options:
  --old <url>          Legacy (ver3) host base, e.g. https://old.example   [required]
  --new <url>          New (ver4) host base                                [required]
  --matrix <file>      Route matrix CSV (default: tests/fixtures/route-matrix.csv)
  --params <json>      Path-param values, e.g. '{"capture_id":"abc"}'
                       Routes with an unfilled {param} are skipped (skipped_param).
  --whitelist <json>   JSON array of key/path patterns treated as envelope-variable
                       (ignored in body diff). '*' is a wildcard.
                       Default: ${JSON.stringify(DEFAULT_WHITELIST)}
  --auth-old <value>   Authorization header value sent to the OLD host
  --auth-new <value>   Authorization header value sent to the NEW host
  --timeout <ms>       Per-request timeout (default: 10000)
  --out <file>         Write the JSON report to <file> (default: stdout)
  --help               Show this help

Only GET is ever issued (POST/PATCH rows are dropped). Requests run serially with
one retry so the legacy host is not load-spiked.

Verdicts: match | diff | old-only | new-only | skipped_param | error`;

async function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      old: { type: "string" },
      new: { type: "string" },
      matrix: { type: "string" },
      params: { type: "string" },
      whitelist: { type: "string" },
      "auth-old": { type: "string" },
      "auth-new": { type: "string" },
      timeout: { type: "string" },
      out: { type: "string" },
      help: { type: "boolean" },
    },
    allowPositionals: false,
  });

  if (values.help || (!values.old && !values.new)) {
    console.log(HELP);
    return values.help ? 0 : 1;
  }
  if (!values.old || !values.new) {
    console.error("error: both --old and --new are required (see --help)");
    return 1;
  }

  const matrixPath = values.matrix
    ? values.matrix
    : fileURLToPath(new URL("../tests/fixtures/route-matrix.csv", import.meta.url));
  const csvText = readFileSync(matrixPath, "utf8");

  const opts = {
    params: values.params ? JSON.parse(values.params) : {},
    whitelist: values.whitelist ? JSON.parse(values.whitelist) : DEFAULT_WHITELIST,
    authOld: values["auth-old"],
    authNew: values["auth-new"],
    timeoutMs: values.timeout ? Number(values.timeout) : 10_000,
  };

  const report = await reconcile(csvText, values.old, values.new, opts);
  const json = JSON.stringify(report, null, 2);
  if (values.out) {
    writeFileSync(values.out, json);
    console.error(`report written to ${values.out}`);
    console.error(`totals: ${JSON.stringify(report.totals)}`);
  } else {
    console.log(json);
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(String(e?.stack ?? e));
      process.exit(1);
    });
}
