#!/usr/bin/env node
// codegen: 04-traceability/rtm.json (SSOT) -> rtm.csv + rtm.md (human-readable
// traceability views). Direction is ONE-WAY: rtm.json -> views. Never hand-edit
// the csv/md (逆流禁止 — AGENTS.md 禁止事項). Fix rtm.json and re-run.
//
// Both outputs carry a GENERATED header. Output is deterministic (fixed column
// order, requirements in file order) so re-runs are byte-identical and --check
// can byte-compare. Batch F4 解消: gives rtm.csv/md a defined generator.
//
// Usage:
//   node scripts/gen-rtm-views.mjs          # regenerate in place
//   node scripts/gen-rtm-views.mjs --check  # regen in memory, byte-compare, exit 1 on drift
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "04-traceability", "rtm.json");
const CSV = join(ROOT, "04-traceability", "rtm.csv");
const MD = join(ROOT, "04-traceability", "rtm.md");

const GATES = ["req", "det", "test", "trn_ui", "retrofit"];

function refs(entry, gate) {
  const v = entry?.[gate];
  if (v == null) return [];
  return Array.isArray(v) ? v : [String(v)];
}

// RFC-4180 cell: quote always, double internal quotes. Keeps commas/newlines safe.
function csvCell(s) {
  return '"' + String(s).replace(/"/g, '""') + '"';
}

function buildCsv(rtm) {
  const lines = [
    "# GENERATED FILE — do not edit by hand.",
    "# source: 04-traceability/rtm.json",
    "# regenerate: node scripts/gen-rtm-views.mjs",
    `# mode: ${rtm.mode}`,
    ["id", "title", ...GATES].map(csvCell).join(","),
  ];
  for (const e of rtm.requirements) {
    const row = [
      e.id,
      e.title ?? "",
      ...GATES.map((g) => refs(e, g).join("; ")),
    ];
    lines.push(row.map(csvCell).join(","));
  }
  return lines.join("\n") + "\n";
}

// Markdown cell: escape pipes, join multiple refs with <br>.
function mdCell(list) {
  return list.map((r) => String(r).replace(/\|/g, "\\|")).join("<br>") || "—";
}

function buildMd(rtm) {
  const header = [
    "<!-- GENERATED FILE — do not edit by hand. -->",
    "<!-- source: 04-traceability/rtm.json -->",
    "<!-- regenerate: node scripts/gen-rtm-views.mjs -->",
    "",
    "# RTM — C5 K8 要件トレーサビリティ表",
    "",
    `- 正本: \`04-traceability/rtm.json\`（本表は生成物・手編集禁止）`,
    `- mode: \`${rtm.mode}\`（warn = 未閉包を警告し exit 0 / enforce = exit 1）`,
    `- 5 点ゲート: req / det / **test**（テスト設計免除不可）/ trn_ui / retrofit`,
    "",
    "| ID | タイトル | req | det | test | trn_ui | retrofit |",
    "|----|----------|-----|-----|------|--------|----------|",
  ];
  const rows = rtm.requirements.map((e) => {
    const cells = [
      e.id,
      String(e.title ?? "").replace(/\|/g, "\\|"),
      ...GATES.map((g) => mdCell(refs(e, g))),
    ];
    return "| " + cells.join(" | ") + " |";
  });
  return header.concat(rows, [""]).join("\n");
}

const rtm = JSON.parse(readFileSync(SRC, "utf8"));
const csv = buildCsv(rtm);
const md = buildMd(rtm);

if (process.argv.includes("--check")) {
  const drift = [];
  for (const [path, want] of [[CSV, csv], [MD, md]]) {
    const have = existsSync(path) ? readFileSync(path, "utf8").replace(/\r\n/g, "\n") : null;
    if (have !== want) drift.push(path.replace(ROOT, "").replace(/\\/g, "/").replace(/^\//, ""));
  }
  if (drift.length) {
    console.error("gen-rtm-views --check FAILED: rtm views out of sync with rtm.json:");
    for (const d of drift) console.error("  - " + d);
    console.error("fix: node scripts/gen-rtm-views.mjs  (never hand-edit generated views)");
    process.exit(1);
  }
  console.log("gen-rtm-views --check OK");
} else {
  writeFileSync(CSV, csv, "utf8");
  writeFileSync(MD, md, "utf8");
  console.log(`gen-rtm-views OK: wrote ${CSV} + ${MD}`);
}
