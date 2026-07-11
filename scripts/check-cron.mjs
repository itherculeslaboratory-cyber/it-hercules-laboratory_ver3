#!/usr/bin/env node
// GATE: unconsented cron (V3-SEC-52). Any scheduled trigger declared in a
// wrangler.toml `[triggers] crons = [...]` must appear in the consent allowlist
// config/consented-crons.json. An absent allowlist file = empty list = every
// cron is a violation (a cron may only exist after a human consents to it).
// scanWranglerCron(tomlText, consented) is exported for the TC.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Extract the cron strings from a wrangler.toml `[triggers]` block ([] if none). */
export function extractCrons(tomlText) {
  const m = tomlText.match(/crons\s*=\s*\[([\s\S]*?)\]/);
  if (!m) return [];
  return [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
}

/** Return the crons present in the toml but NOT in the consented allowlist. */
export function scanWranglerCron(tomlText, consented = []) {
  const allow = new Set(consented);
  return extractCrons(tomlText).filter((c) => !allow.has(c));
}

function loadConsented(root) {
  const p = join(root, "config", "consented-crons.json");
  if (!existsSync(p)) return []; // no allowlist = nothing consented
  const doc = JSON.parse(readFileSync(p, "utf8"));
  return Array.isArray(doc) ? doc : Array.isArray(doc.crons) ? doc.crons : [];
}

function runGate() {
  const root = process.cwd();
  const consented = loadConsented(root);
  const violations = [];
  for (const rel of ["apps/api/wrangler.toml"]) {
    const p = join(root, rel);
    if (!existsSync(p)) continue;
    for (const cron of scanWranglerCron(readFileSync(p, "utf8"), consented)) {
      violations.push(`${rel}: unconsented cron "${cron}"`);
    }
  }
  return violations;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const violations = runGate();
  if (violations.length) {
    console.error("cron GATE FAILED (add to config/consented-crons.json after human consent):");
    for (const v of violations) console.error("  - " + v);
    process.exit(1);
  }
  console.log("cron GATE OK");
}
