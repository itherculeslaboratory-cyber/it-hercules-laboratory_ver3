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
const REGISTRY = join(ROOT, "01-requirements", "registry.json");
const CSV = join(ROOT, "04-traceability", "rtm.csv");
const MD = join(ROOT, "04-traceability", "rtm.md");

// 網羅率注記(2026-08-07 order-2026-08-07-docs-plan-a T2④): registry.json の総件数を
// 分母に実測する。ハードコード値は書かない(ズレたら次に読む者を欺くため)。
function coverageNote(rtm) {
  if (!existsSync(REGISTRY)) return null;
  const total = JSON.parse(readFileSync(REGISTRY, "utf8")).length;
  const covered = rtm.requirements.length;
  const pct = total > 0 ? ((covered / total) * 100).toFixed(1) : "0.0";
  return `現在網羅率${pct}%(${covered}/${total})・全数トレースは本格整備(案B)で対応`;
}

// 静的監査カバレッジ(04-traceability/coverage-audit.json)を「別指標として」併記する。
// 5点閉包率と足したり平均したりしない(2指標は別のものを測っている)。
function auditNote() {
  const p = join(ROOT, "04-traceability", "coverage-audit.json");
  if (!existsSync(p)) return [];
  const a = JSON.parse(readFileSync(p, "utf8"));
  const total = a?.denominator?.total ?? 0;
  const n = Array.isArray(a?.entries) ? a.entries.length : 0;
  if (!total || !n) return [];
  const eff = a.entries.map((e) =>
    e?.revision?.reverified === true ? e.revision.verdict : e.verdict
  );
  const c = {};
  for (const v of eff) c[v] = (c[v] ?? 0) + 1;
  const order = ["implemented", "partial", "unverifiable", "missing"];
  const brk = order.filter((k) => c[k]).map((k) => `${k} ${c[k]}`).join(" / ");
  return [
    `- **静的監査カバー率${((n / total) * 100).toFixed(1)}%(${n}/${total})** — 内訳: ${brk}`,
    // ★ハードコード注意(2026-08-08 W3-G検分・軽2): 下の「実測:」以降の数字は
    // リテラルであり rtm.json / coverage-audit.json が変わっても自動更新されない
    // (--check も検出しない)。2026-08-08 時点では現物と一致することを確認済み。
    // 数字を動的化するか、注記自体を落とすかは要判断のため本ラウンドでは変更しない。
    `- ⚠ 上の2つは**別指標**。5点閉包(テスト参照必須)と静的監査判定(テスト裏付けなし)を足す・平均する・「実質○%」と言うことを禁ずる。実測: 閉包済み17件のうち16件に監査判定があり、内訳は implemented 7 / unverifiable 9。`,
  ];
}

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
  const note = coverageNote(rtm);
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
    ...(note ? [`- **${note}**`] : []),
    ...auditNote(),
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
