#!/usr/bin/env node
// GATE: RTM closure — every implementation-target requirement ID must close to a
// reference on all five V-model gates (V3-AIP-05 / 5 点ゲート機械判定). The TEST
// gate is the load-bearing one: an ID whose `test` (TEST 層) reference is empty
// ALWAYS fails (テスト設計ゲート免除不可). The other four gates (req/det/trn_ui/
// retrofit) are presence checks.
//
// 正本 = 04-traceability/rtm.json (hand-authored by the traceability package).
// While C5 is in flight the正本 carries `mode:"warn"`: violations are printed but
// exit is 0 (lint stays green). When全クラスタ TC が緑化し閉包 100% を実測したら
// mode を "enforce" に flip し exit 1 で門を締める (§1.8 / §5).
//
// rtm.json が未存在なら (traceability パッケージ未産出) warn + exit 0 でクラッシュ
// しない。checkRtm(rtm) を export し guards.test.ts が合成 rtm で検証する。
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// The five V-model gates. `test` (TEST 層) can never be exempted; the other four
// are presence checks — all must carry ≥1 reference for an ID to close.
export const RTM_GATES = ["req", "det", "test", "trn_ui", "retrofit"];

function refsFor(entry, gate) {
  const v = entry?.[gate];
  if (v == null) return [];
  return Array.isArray(v) ? v.filter((r) => typeof r === "string" && r.trim()) : [String(v)].filter((r) => r.trim());
}

/**
 * Return the list of closure violations for an rtm object.
 * rtm = { mode: "warn"|"enforce", requirements: [{ id, req, det, test, trn_ui, retrofit }] }.
 * Each gate value may be a string or string[] (missing/empty = no reference).
 * [] = every ID closes on all five gates.
 */
export function checkRtm(rtm) {
  const out = [];
  const reqs = Array.isArray(rtm?.requirements) ? rtm.requirements : [];
  for (const entry of reqs) {
    const id = entry?.id ?? "(no id)";
    for (const gate of RTM_GATES) {
      if (refsFor(entry, gate).length === 0) {
        out.push(`${id}: gate '${gate}' has no reference`);
      }
    }
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const path = join(process.cwd(), "04-traceability", "rtm.json");
  if (!existsSync(path)) {
    console.log("rtm GATE: 04-traceability/rtm.json not present yet — skipped (warn).");
    process.exit(0);
  }
  const rtm = JSON.parse(readFileSync(path, "utf8"));
  const mode = rtm.mode === "enforce" ? "enforce" : "warn";
  const violations = checkRtm(rtm);
  if (violations.length === 0) {
    console.log("rtm GATE OK (all IDs close on 5 gates).");
    process.exit(0);
  }
  console.error(`rtm GATE ${mode === "enforce" ? "FAILED" : "WARN"} — unclosed gates:`);
  for (const v of violations) console.error("  - " + v);
  process.exit(mode === "enforce" ? 1 : 0);
}
