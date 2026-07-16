#!/usr/bin/env node
// C8 ラン進捗追跡: docs/planning/c8/progress.json (SSOT) -> progress.md (人間可読ビュー)。
// 一方向のみ(逆流禁止 — AGENTS.md 禁止事項)。progress.md を手編集するな、
// progress.json を直して再生成しろ。
//
// --check モードは二役: (1) progress.md のドリフト検査(gen-rtm-views.mjs と同型)
// (2) progress.json 全件の整合検査 — id が 01-requirements/registry.json に実在するか、
//     status が語彙(todo|in_progress|done|verified)内か。不一致で exit 1。
//
// Usage:
//   node scripts/render-c8-progress.mjs          # regenerate in place
//   node scripts/render-c8-progress.mjs --check  # drift + 整合検査、exit 1 on failure
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const JSON_SRC = join(ROOT, "docs", "planning", "c8", "progress.json");
const MD_OUT = join(ROOT, "docs", "planning", "c8", "progress.md");
const REGISTRY = join(ROOT, "01-requirements", "registry.json");

const STATUS_VALUES = ["todo", "in_progress", "done", "verified"];
const STATUS_LABEL = { todo: "未着手", in_progress: "着手中", done: "完了", verified: "検証済" };

function bar(done, total, width = 20) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const filled = total === 0 ? 0 : Math.round((width * done) / total);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)} ${pct}%（${done}/${total}）`;
}

function countBy(items, key) {
  const m = new Map();
  for (const i of items) m.set(i[key], (m.get(i[key]) || 0) + 1);
  return m;
}

// "完了" = done か verified(進捗バー用の達成扱い)
const isDone = (i) => i.status === "done" || i.status === "verified";

function buildMd(items) {
  const total = items.length;
  const required = items.filter((i) => i.scope === "required");
  const bestEffort = items.filter((i) => i.scope === "best-effort");

  const lines = [
    "<!-- GENERATED FILE — do not edit by hand. -->",
    "<!-- source: docs/planning/c8/progress.json -->",
    "<!-- regenerate: node scripts/render-c8-progress.mjs -->",
    "",
    "# C8 ラン進捗（正本: progress.json）",
    "",
    "- 正本: `docs/planning/c8/progress.json`（本表は生成物・手編集禁止）",
    "- status 語彙: todo(未着手) / in_progress(着手中) / done(完了) / verified(検証済)",
    "- scope: required(第1波必達) / best-effort(第2波)",
    "",
    "## サマリー",
    "",
    `- 全体: ${bar(items.filter(isDone).length, total)}`,
    `- 第1波必達(required): ${bar(required.filter(isDone).length, required.length)}`,
    `- 第2波(best-effort): ${bar(bestEffort.filter(isDone).length, bestEffort.length)}`,
    "",
    "| status | 件数 |",
    "|---|---|",
  ];
  for (const s of STATUS_VALUES) {
    lines.push(`| ${STATUS_LABEL[s]}(${s}) | ${items.filter((i) => i.status === s).length} |`);
  }

  lines.push("", "## lane 別内訳", "", "| lane | 進捗 |", "|---|---|");
  const laneCounts = countBy(items, "lane");
  for (const lane of [...laneCounts.keys()].sort()) {
    const laneItems = items.filter((i) => i.lane === lane);
    lines.push(`| ${lane} | ${bar(laneItems.filter(isDone).length, laneItems.length)} |`);
  }

  lines.push("", "## lane 別明細");
  for (const lane of [...laneCounts.keys()].sort()) {
    const laneItems = items
      .filter((i) => i.lane === lane)
      .sort((a, b) => (a.scope === b.scope ? a.id.localeCompare(b.id) : a.scope === "required" ? -1 : 1));
    lines.push("", `### ${lane}`, "", "| id | title | scope | status | commits |", "|---|---|---|---|---|");
    for (const i of laneItems) {
      const commits = i.commits.length ? i.commits.join(", ") : "—";
      lines.push(`| ${i.id} | ${i.title.replace(/\|/g, "\\|")} | ${i.scope} | ${i.status} | ${commits} |`);
    }
  }

  return lines.join("\n") + "\n";
}

function checkIntegrity(items) {
  const problems = [];
  const registryIds = new Set(JSON.parse(readFileSync(REGISTRY, "utf8")).map((e) => e.id));
  for (const i of items) {
    if (!registryIds.has(i.id)) problems.push(`unknown id (not in registry.json): ${i.id}`);
    if (!STATUS_VALUES.includes(i.status)) problems.push(`invalid status "${i.status}" for ${i.id}`);
  }
  return problems;
}

const items = JSON.parse(readFileSync(JSON_SRC, "utf8"));
const md = buildMd(items);

if (process.argv.includes("--check")) {
  let failed = false;

  const have = existsSync(MD_OUT) ? readFileSync(MD_OUT, "utf8").replace(/\r\n/g, "\n") : null;
  if (have !== md) {
    console.error("render-c8-progress --check FAILED: progress.md out of sync with progress.json");
    console.error("fix: node scripts/render-c8-progress.mjs");
    failed = true;
  }

  const problems = checkIntegrity(items);
  if (problems.length) {
    console.error("render-c8-progress --check FAILED: progress.json integrity:");
    for (const p of problems) console.error("  - " + p);
    failed = true;
  }

  if (failed) process.exit(1);
  console.log("render-c8-progress --check OK");
} else {
  writeFileSync(MD_OUT, md, "utf8");
  console.log(`render-c8-progress OK: wrote ${MD_OUT}`);
}
