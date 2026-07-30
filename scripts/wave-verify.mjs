#!/usr/bin/env node
// GATE: 波検収(Wave verify)。計画書 D:\claude\00-hq\R0730-ad0c0b-PLAN-ihl3-core-2026-07-31.md
// §9(D8 検収・批評ゲート)の5検査を1本にまとめたもの。引数=艦名(付録Aのニーモニック、
// 例: w1-fnd)。艦の担当ID集合に対する progress.json 適用率(分母=担当ID数・分子=完了ID数)を
// 出す。新規依存ゼロ(node標準機能のみ)。
//
// 5検査:
//   1. lint EXIT (`npm run lint`)
//   2. test EXIT + 件数非減 (`npm test -w apps/api -w tests -w apps/web`)
//   3. progress.json 分母/分子・適用率(担当ID別)
//   4. 凍結違反grep(package.json差分・redux/zustand/mui/antd import)
//   5. 秘密混入grep(sk_live/api_key=/BEGIN...PRIVATE/D:\env)
//
// worktree残骸(.claude/worktrees/**)とnode_modules/**はgit ls-filesが親リポジトリの
// 追跡ファイルしか返さない性質を利用して自然に除外する(git worktreeは別リポジトリのため
// 親の`git ls-files`には現れない。手動exclude不要=計画書批評指摘の対策)。
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// ---- 付録A 艦別・担当ID明示リスト(機械可読・出典=計画書付録A。ID kind 進捗) ----
const ROSTER_TEXT = {
  "w1-fnd": `
V3-CST-04 制約 -
V3-CST-05 制約 -
V3-FND-10 制約 -
V3-FND-11 制約 -
V3-FND-15 制約 -
V3-FND-16 制約 -
V3-FND-17 制約 -
V3-FND-19 制約 -
V3-FND-20 アイデア in_progress
V3-FND-25 思想 -
V3-FND-30 制約 -
V3-I18-02 機能要件 in_progress
V3-I18-04 制約 -
V3-CST-03 非機能要件 todo
V3-FND-06 制約 -
V3-FND-07 機能要件 todo
V3-FND-08 機能要件 todo
V3-FND-22 機能要件 todo
V3-FND-23 非機能要件 todo
V3-FND-31 機能要件 todo
V3-FND-33 非機能要件 todo
V3-I18-05 制約 -
V3-I18-09 機能要件 todo
V3-I18-10 機能要件 todo
V3-I18-11 機能要件 todo
V3-I18-17 思想 -
`,
  "w1-aut": `
V3-AUT-02 制約 -
V3-AUT-04 制約 -
V3-AUT-05 機能要件 -
V3-AUT-13 制約 -
V3-AUT-14 制約 -
V3-AUT-15 機能要件 blocked
V3-AUT-16 制約 -
V3-AUT-17 制約 -
V3-AUT-18 制約 -
V3-AUT-19 機能要件 in_progress
V3-AUT-22 機能要件 -
V3-AUT-45 制約 -
V3-AUT-24 制約 -
V3-AUT-26 機能要件 todo
V3-AUT-28 機能要件 todo
V3-AUT-31 機能要件 todo
V3-AUT-32 非機能要件 todo
V3-AUT-33 決定 -
V3-AUT-38 機能要件 todo
V3-AUT-40 機能要件 todo
V3-AUT-41 機能要件 todo
`,
  "w1-sec": `
V3-SEC-02 非機能要件 -
V3-SEC-03 制約 blocked
V3-SEC-04 制約 -
V3-SEC-05 制約 -
V3-SEC-06 制約 -
V3-SEC-07 制約 -
V3-SEC-11 制約 -
V3-SEC-13 機能要件 -
V3-SEC-15 制約 -
V3-SEC-16 制約 -
V3-SEC-17 制約 -
V3-SEC-19 制約 -
V3-SEC-24 制約 -
V3-SEC-26 制約 -
V3-SEC-30 思想 -
V3-SEC-31 思想 -
V3-SEC-34 制約 -
V3-SEC-45 非機能要件 in_progress
V3-SEC-46 制約 -
V3-SEC-52 制約 -
V3-SEC-01 制約 -
V3-SEC-08 非機能要件 todo
V3-SEC-10 非機能要件 todo
V3-SEC-12 機能要件 todo
V3-SEC-21 機能要件 todo
V3-SEC-22 機能要件 todo
V3-SEC-23 機能要件 todo
V3-SEC-25 制約 -
V3-SEC-27 制約 -
V3-SEC-29 制約 -
V3-SEC-35 制約 -
V3-SEC-37 制約 -
V3-SEC-39 非機能要件 todo
V3-SEC-43 機能要件 todo
V3-SEC-44 機能要件 todo
V3-SEC-47 非機能要件 todo
V3-SEC-48 非機能要件 todo
V3-SEC-50 制約 -
`,
  "w1-obs": `
V3-OBS-01 機能要件 -
V3-OBS-03 制約 -
V3-OBS-04 制約 -
V3-OBS-05 制約 -
V3-OBS-10 非機能要件 -
V3-OBS-15 制約 -
V3-OBS-16 制約 -
V3-OBS-18 機能要件 -
V3-OBS-21 機能要件 -
V3-OBS-28 機能要件 -
V3-OBS-29 制約 -
V3-OBS-31 機能要件 -
V3-OBS-44 制約 -
V3-OBS-45 機能要件 in_progress
V3-OBS-46 機能要件 in_progress
V3-OBS-47 機能要件 in_progress
V3-OBS-52 制約 -
V3-OBS-53 機能要件 in_progress
V3-OBS-54 制約 -
V3-OBS-62 機能要件 in_progress
V3-OBS-63 機能要件 -
V3-OBS-12 機能要件 todo
V3-OBS-13 非機能要件 -
V3-OBS-30 機能要件 todo
V3-OBS-33 機能要件 todo
V3-OBS-34 機能要件 todo
V3-OBS-38 非機能要件 todo
V3-OBS-40 機能要件 todo
V3-OBS-42 機能要件 todo
V3-OBS-50 機能要件 todo
V3-OBS-51 機能要件 todo
V3-OBS-55 制約 -
V3-OBS-58 機能要件 todo
V3-OBS-64 機能要件 todo
V3-OBS-65 制約 -
V3-OBS-66 機能要件 todo
V3-OBS-67 機能要件 todo
V3-OBS-69 機能要件 todo
V3-OBS-70 機能要件 todo
V3-OBS-71 機能要件 todo
`,
  "w1-mkt": `
V3-MKT-01 機能要件 -
V3-MKT-11 制約 -
V3-MKT-15 制約 -
V3-MKT-19 思想 -
V3-MKT-25 機能要件 in_progress
V3-MKT-36 機能要件 in_progress
V3-MKT-39 制約 -
V3-MKT-55 制約 -
V3-MKT-62 機能要件 in_progress
V3-MKT-63 機能要件 in_progress
V3-OTH-01 思想 -
V3-OTH-02 思想 -
V3-OTH-03 制約 -
V3-OTH-05 思想 -
V3-OTH-06 思想 -
V3-OTH-07 思想 -
V3-OTH-10 制約 -
V3-OTH-12 非機能要件 -
V3-OTH-27 思想 -
V3-MKT-07 機能要件 todo
V3-MKT-08 機能要件 todo
V3-MKT-09 機能要件 todo
V3-MKT-16 機能要件 todo
V3-MKT-17 機能要件 todo
V3-MKT-21 機能要件 todo
V3-MKT-24 機能要件 todo
V3-MKT-26 機能要件 todo
V3-MKT-28 制約 -
V3-MKT-34 アイデア todo
V3-MKT-41 非機能要件 todo
V3-MKT-42 機能要件 todo
V3-MKT-44 機能要件 todo
V3-MKT-52 非機能要件 todo
V3-MKT-56 機能要件 todo
V3-MKT-59 アイデア todo
V3-MKT-66 機能要件 -
V3-MKT-67 制約 -
V3-OTH-09 思想 -
V3-OTH-15 思想 -
V3-OTH-20 機能要件 -
`,
  "w1-plaza": `
V3-BBS-01 機能要件 -
V3-BBS-03 機能要件 in_progress
V3-BBS-09 制約 -
V3-BBS-10 機能要件 -
V3-BBS-16 機能要件 todo
V3-BBS-20 機能要件 -
V3-BBS-29 機能要件 -
V3-BBS-36 思想 -
V3-BBS-37 機能要件 -
V3-BBS-38 機能要件 -
V3-WIK-02 制約 -
V3-WIK-05 制約 -
V3-WIK-06 制約 -
V3-WIK-09 制約 -
V3-WIK-14 機能要件 -
V3-WIK-22 思想 -
V3-WIK-30 思想 -
V3-BBS-02 機能要件 todo
V3-BBS-04 機能要件 todo
V3-BBS-06 機能要件 todo
V3-BBS-08 機能要件 todo
V3-BBS-11 機能要件 todo
V3-BBS-12 機能要件 todo
V3-BBS-15 思想 -
V3-BBS-18 機能要件 todo
V3-BBS-19 機能要件 todo
V3-BBS-21 思想 -
V3-BBS-25 機能要件 todo
V3-BBS-32 機能要件 todo
V3-BBS-33 機能要件 todo
V3-WIK-08 非機能要件 todo
V3-WIK-18 機能要件 todo
V3-WIK-21 機能要件 todo
V3-WIK-23 機能要件 todo
V3-WIK-24 機能要件 todo
V3-WIK-32 機能要件 todo
`,
  "w1-gov": `
V3-GOV-01 思想 -
V3-GOV-09 制約 -
V3-GOV-10 機能要件 in_progress
V3-GOV-12 機能要件 -
V3-GOV-13 思想 -
V3-GOV-19 思想 -
V3-GOV-20 思想 -
V3-GOV-22 制約 -
V3-GOV-23 思想 -
V3-KRM-01 機能要件 -
V3-KRM-02 機能要件 -
V3-KRM-13 機能要件 -
V3-KRM-16 機能要件 -
V3-KRM-23 思想 -
V3-KRM-25 機能要件 -
V3-KRM-32 機能要件 in_progress
V3-GOV-02 機能要件 todo
V3-GOV-03 機能要件 todo
V3-GOV-04 制約 -
V3-GOV-05 機能要件 todo
V3-GOV-06 機能要件 todo
V3-GOV-08 機能要件 todo
V3-GOV-14 制約 -
V3-GOV-15 機能要件 todo
V3-GOV-16 思想 -
V3-GOV-17 機能要件 todo
V3-GOV-18 制約 -
V3-GOV-21 思想 -
V3-GOV-24 機能要件 todo
V3-GOV-25 制約 -
V3-GOV-26 機能要件 todo
V3-GOV-34 機能要件 todo
V3-GOV-36 機能要件 -
V3-KRM-08 思想 -
V3-KRM-09 機能要件 todo
V3-KRM-14 機能要件 todo
V3-KRM-15 機能要件 todo
V3-KRM-17 機能要件 todo
V3-KRM-22 機能要件 todo
V3-KRM-29 機能要件 todo
`,
  "w1-ind": `
V3-IND-01 機能要件 -
V3-IND-07 機能要件 -
V3-IND-15 機能要件 in_progress
V3-IND-18 制約 -
V3-IND-19 機能要件 -
V3-IND-20 機能要件 in_progress
V3-IND-30 制約 -
V3-IND-34 機能要件 in_progress
V3-PPR-03 機能要件 in_progress
V3-PPR-04 思想 -
V3-PPR-14 思想 -
V3-IND-03 機能要件 todo
V3-IND-05 機能要件 todo
V3-IND-06 機能要件 todo
V3-IND-09 機能要件 todo
V3-IND-11 機能要件 todo
V3-IND-16 機能要件 todo
V3-IND-17 制約 -
V3-IND-23 機能要件 todo
V3-IND-26 機能要件 todo
V3-IND-28 機能要件 todo
V3-IND-29 機能要件 todo
V3-IND-31 思想 -
V3-PPR-05 機能要件 todo
V3-PPR-08 機能要件 todo
V3-PPR-10 制約 -
V3-PPR-11 機能要件 todo
V3-PPR-15 機能要件 todo
V3-PPR-19 思想 -
V3-PPR-21 アイデア todo
V3-PPR-24 思想 -
V3-PPR-25 機能要件 todo
`,
  "w1-aip": `
V3-AIP-01 制約 -
V3-AIP-02 制約 -
V3-AIP-03 制約 -
V3-AIP-04 制約 -
V3-AIP-05 制約 -
V3-AIP-06 制約 -
V3-AIP-08 制約 -
V3-AIP-09 思想 -
V3-AIP-10 制約 -
V3-AIP-101 制約 -
V3-AIP-105 機能要件 -
V3-AIP-106 非機能要件 -
V3-AIP-107 機能要件 -
V3-AIP-11 制約 -
V3-AIP-12 制約 -
V3-AIP-13 制約 -
V3-AIP-14 制約 -
V3-AIP-15 制約 -
V3-AIP-16 制約 -
V3-AIP-17 制約 -
V3-AIP-18 制約 -
V3-AIP-19 制約 -
V3-AIP-20 制約 -
V3-AIP-21 制約 -
V3-AIP-24 制約 -
V3-AIP-25 制約 -
V3-AIP-26 制約 -
V3-AIP-27 制約 -
V3-AIP-29 制約 -
V3-AIP-30 制約 -
V3-AIP-32 制約 -
V3-AIP-33 制約 -
V3-AIP-34 思想 in_progress
V3-AIP-35 制約 -
V3-AIP-36 機能要件 -
V3-AIP-37 制約 -
V3-AIP-40 機能要件 -
V3-AIP-41 思想 -
V3-AIP-43 思想 -
V3-AIP-44 制約 -
V3-AIP-45 機能要件 -
V3-AIP-46 制約 -
V3-AIP-48 制約 -
V3-AIP-49 非機能要件 in_progress
V3-AIP-50 機能要件 in_progress
V3-AIP-52 思想 -
V3-AIP-53 思想 -
V3-AIP-54 思想 -
V3-AIP-55 制約 -
V3-AIP-56 制約 -
V3-AIP-59 思想 -
V3-AIP-61 アイデア -
V3-AIP-63 思想 -
V3-AIP-64 制約 -
V3-AIP-65 制約 -
V3-AIP-66 制約 -
V3-AIP-68 機能要件 -
V3-AIP-70 制約 -
V3-AIP-76 機能要件 -
V3-AIP-80 思想 -
V3-AIP-92 機能要件 blocked
V3-AIP-94 制約 -
V3-AIP-99 制約 -
V3-AIP-100 機能要件 todo
V3-AIP-102 機能要件 todo
V3-AIP-103 機能要件 todo
V3-AIP-47 思想 -
V3-AIP-51 思想 -
V3-AIP-58 制約 -
V3-AIP-62 アイデア todo
V3-AIP-71 非機能要件 todo
V3-AIP-73 思想 -
V3-AIP-75 機能要件 todo
V3-AIP-79 思想 -
V3-AIP-81 思想 -
V3-AIP-82 機能要件 todo
V3-AIP-87 機能要件 todo
V3-AIP-88 制約 -
V3-AIP-89 思想 -
V3-AIP-91 思想 -
V3-AIP-95 非機能要件 todo
`,
  "wave4-ui": `
V3-UIX-01 制約 -
V3-UIX-02 非機能要件 -
V3-UIX-03 非機能要件 -
V3-UIX-05 非機能要件 -
V3-UIX-06 制約 -
V3-UIX-08 制約 -
V3-UIX-14 機能要件 -
V3-UIX-16 機能要件 -
V3-UIX-17 思想 -
V3-UIX-18 制約 -
V3-UIX-21 機能要件 in_progress
V3-UIX-37 制約 -
V3-UIX-45 機能要件 -
V3-UIX-59 機能要件 todo
V3-UIX-68 機能要件 in_progress
V3-UIX-76 思想 -
V3-UIX-83 機能要件 -
V3-UIX-84 思想 -
V3-UIX-09 アイデア todo
V3-UIX-10 機能要件 todo
V3-UIX-11 機能要件 todo
V3-UIX-12 機能要件 todo
V3-UIX-19 制約 -
V3-UIX-22 機能要件 todo
V3-UIX-23 機能要件 todo
V3-UIX-29 機能要件 todo
V3-UIX-31 機能要件 todo
V3-UIX-33 アイデア todo
V3-UIX-35 機能要件 todo
V3-UIX-36 機能要件 todo
V3-UIX-38 非機能要件 todo
V3-UIX-40 機能要件 todo
V3-UIX-42 機能要件 todo
V3-UIX-44 機能要件 todo
V3-UIX-46 機能要件 todo
V3-UIX-47 機能要件 todo
V3-UIX-51 機能要件 todo
V3-UIX-53 思想 -
V3-UIX-55 非機能要件 todo
V3-UIX-58 機能要件 todo
V3-UIX-61 機能要件 todo
V3-UIX-67 思想 -
V3-UIX-71 機能要件 todo
V3-UIX-75 思想 -
V3-UIX-78 機能要件 todo
V3-UIX-79 機能要件 todo
V3-UIX-82 機能要件 in_progress
`,
  "trackv": `
V3-VID-01 機能要件 -
V3-VID-02 機能要件 -
V3-VID-03 機能要件 -
V3-VID-07 アイデア -
V3-VID-08 アイデア -
V3-VID-09 思想 -
V3-VID-11 制約 -
V3-VID-12 機能要件 -
V3-VID-13 機能要件 -
V3-VID-15 思想 -
V3-VID-16 機能要件 -
V3-VID-17 機能要件 -
V3-VID-18 機能要件 -
V3-VID-19 機能要件 -
V3-VID-23 機能要件 -
V3-VID-27 制約 -
V3-VID-28 機能要件 -
V3-VID-29 制約 -
V3-VID-31 制約 -
V3-VID-32 制約 -
V3-VID-ROUTE-A 機能要件 -
V3-VID-ROUTE-B 機能要件 -
V3-VID-ROUTE-C 機能要件 -
V3-VID-STORE 制約 -
`,
};

const F_KINDS = new Set(["機能要件", "非機能要件"]);

/** @returns {{id:string, kind:"F"|"C"}[]} */
export function parseRoster(shipKey) {
  const text = ROSTER_TEXT[shipKey];
  if (!text) return null;
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [id, kindJa] = line.trim().split(/\s+/);
      return { id, kind: F_KINDS.has(kindJa) ? "F" : "C" };
    });
}

export function listShips() {
  return Object.keys(ROSTER_TEXT);
}

/** progress.json 突合: 分母=roster件数、分子=完了件数(型F=status:done かつ tc非空、型C=status:done)。 */
export function computeApplyRate(roster, progressEntries) {
  const byId = new Map(progressEntries.map((e) => [e.id, e]));
  const rows = roster.map(({ id, kind }) => {
    const entry = byId.get(id);
    const inProgressStatus = entry ? entry.status : "(未掲載)";
    const complete = !!entry && entry.status === "done" && (kind === "C" || (Array.isArray(entry.tc) && entry.tc.length > 0));
    return { id, kind, status: inProgressStatus, complete };
  });
  const numerator = rows.filter((r) => r.complete).length;
  return { denominator: rows.length, numerator, rate: rows.length ? numerator / rows.length : 0, rows };
}

// ---- 検査1: lint ----
function runLint() {
  try {
    const out = execSync("npm run lint", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: "pipe" });
    return { exit: 0, out };
  } catch (e) {
    return { exit: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

// ---- 検査2: test EXIT + 件数 ----
function runTest() {
  try {
    const out = execSync("npm test -w apps/api -w tests -w apps/web", {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: "pipe",
    });
    return { exit: 0, out, total: sumTestCounts(out) };
  } catch (e) {
    const out = (e.stdout ?? "") + (e.stderr ?? "");
    return { exit: e.status ?? 1, out, total: sumTestCounts(out) };
  }
}

// eslint-ish: vitestのターミナル出力はANSIエスケープで色付けされる
// ("[2m Tests [22m[1m[32m18 passed[39m[22m..." のように "Tests" と数字の間に
// エスケープシーケンスが挟まる)。ANSIを剥がしてから件数を拾う。
function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function sumTestCounts(out) {
  // vitestの " Tests  N passed (N)" 行をワークスペースごとに合算する。
  const matches = [...stripAnsi(out).matchAll(/Tests\s+(\d+)\s+passed/g)];
  return matches.reduce((sum, m) => sum + Number(m[1]), 0);
}

// ---- 検査4/5共通: git diff の追加行だけを対象にする ----
// (計画書§9原文「差分内に...出現ゼロ」= リポジトリ全体ではなく、この艦が今回
// 追加した行だけを見る。全体スキャンだと既存の正当なテンプレ/ドキュメント
// (.env.*.example のプレースホルダ、D:\env という「実値はここに置く」という
// 説明文そのもの等)を誤検知する — 実際にw1-fnd試走で誤検知を確認済み)。
function addedLinesFromDiff() {
  let diff = "";
  try {
    diff = execSync("git diff HEAD", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return [];
  }
  const out = [];
  let currentFile = null;
  for (const raw of diff.split(/\r?\n/)) {
    const fileHeader = raw.match(/^\+\+\+ b\/(.+)$/);
    if (fileHeader) {
      currentFile = fileHeader[1];
      continue;
    }
    if (/^(\+\+\+|---|@@|diff |index )/.test(raw)) continue;
    if (!raw.startsWith("+")) continue;
    out.push({ file: currentFile ?? "(unknown)", line: raw.slice(1) });
  }
  return out;
}

function checkFreezeViolations() {
  const violations = [];
  const FORBIDDEN_IMPORT = /\b(from\s+["'](redux|react-redux|zustand|@mui\/|antd)|require\(["'](redux|zustand|@mui\/|antd)\))/;
  for (const { file, line } of addedLinesFromDiff()) {
    if (!/\.(ts|tsx|js|jsx|mjs)$/.test(file)) continue;
    if (FORBIDDEN_IMPORT.test(line)) {
      violations.push(`${file}: forbidden import added (redux/zustand/@mui/antd): ${line.trim().slice(0, 120)}`);
    }
  }
  return violations;
}

function checkPackageJsonDiff(allowPackageJsonPaths) {
  let diffFiles = [];
  try {
    diffFiles = execSync("git diff --name-only HEAD", { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    return [];
  }
  const changedPkg = diffFiles.filter((f) => f.endsWith("package.json"));
  const disallowed = changedPkg.filter((f) => !allowPackageJsonPaths.includes(f.replace(/\\/g, "/")));
  return disallowed.map((f) => `unexpected package.json change: ${f}`);
}

// ---- 検査5: 秘密混入grep(計画書§9の4パターン。diffの追加行のみ対象) ----
function checkSecretLeak() {
  const SECRET_RE = [/sk_live[A-Za-z0-9_]*/, /api_key\s*=\s*["'][^"']+["']/i, /-----BEGIN[A-Z ]*PRIVATE KEY-----/, /D:\\env/i];
  const violations = [];
  for (const { file, line } of addedLinesFromDiff()) {
    for (const re of SECRET_RE) {
      if (re.test(line)) violations.push(`${file}: matched ${re}: ${line.trim().slice(0, 120)}`);
    }
  }
  return violations;
}

function selftest() {
  const roster = parseRoster("w1-fnd");
  console.assert(roster.length === 26, `w1-fnd roster length should be 26, got ${roster.length}`);
  console.assert(roster.find((r) => r.id === "V3-I18-02").kind === "F", "V3-I18-02 should classify as F(機能要件)");
  console.assert(roster.find((r) => r.id === "V3-CST-04").kind === "C", "V3-CST-04(制約) should classify as C");
  const fake = computeApplyRate(
    [{ id: "X-1", kind: "F" }, { id: "X-2", kind: "C" }, { id: "X-3", kind: "F" }],
    [
      { id: "X-1", status: "done", tc: ["t.test.ts"] },
      { id: "X-2", status: "done", tc: [] },
      { id: "X-3", status: "done", tc: [] }, // F型はtc空なら未完了扱い
    ],
  );
  console.assert(fake.denominator === 3, `denominator should be 3, got ${fake.denominator}`);
  console.assert(fake.numerator === 2, `numerator should be 2 (X-1,X-2 complete; X-3 lacks tc), got ${fake.numerator}`);
  console.log("wave-verify selftest: OK (roster parse + apply-rate logic verified)");
}

function main() {
  const shipArg = process.argv[2];
  if (shipArg === "--selftest") {
    selftest();
    return;
  }
  if (!shipArg) {
    console.error(`usage: node scripts/wave-verify.mjs <ship>  (ships: ${listShips().join(", ")})`);
    process.exit(2);
  }
  const roster = parseRoster(shipArg);
  if (!roster) {
    console.error(`unknown ship "${shipArg}". known ships: ${listShips().join(", ")}`);
    process.exit(2);
  }

  console.log(`=== wave-verify: ${shipArg} (担当ID ${roster.length}件) ===`);

  console.log("\n--- 検査1: npm run lint ---");
  const lint = runLint();
  console.log(`lint EXIT=${lint.exit}`);
  if (lint.exit !== 0) console.log(lint.out.slice(-4000));

  console.log("\n--- 検査2: npm test -w apps/api -w tests -w apps/web ---");
  const test = runTest();
  console.log(`test EXIT=${test.exit} / 合算件数=${test.total}`);
  if (test.exit !== 0) console.log(test.out.slice(-4000));

  console.log("\n--- 検査3: progress.json 分母/分子(適用率) ---");
  const progressPath = "docs/planning/c8/progress.json";
  const progressEntries = JSON.parse(readFileSync(progressPath, "utf8"));
  const applyRate = computeApplyRate(roster, progressEntries);
  console.log(`分母=${applyRate.denominator} 分子=${applyRate.numerator} 適用率=${(applyRate.rate * 100).toFixed(1)}%`);
  for (const row of applyRate.rows) {
    console.log(`  ${row.complete ? "[x]" : "[ ]"} ${row.id} (${row.kind}) status=${row.status}`);
  }

  console.log("\n--- 検査4: 凍結違反grep ---");
  const freezeViolations = [...checkFreezeViolations(), ...checkPackageJsonDiff(["apps/web/package.json"])];
  if (freezeViolations.length) {
    console.log("凍結違反GATE FAILED:");
    for (const v of freezeViolations) console.log(`  - ${v}`);
  } else {
    console.log("凍結違反GATE OK(0件)");
  }

  console.log("\n--- 検査5: 秘密混入grep ---");
  const secretViolations = checkSecretLeak();
  if (secretViolations.length) {
    console.log("秘密混入GATE FAILED:");
    for (const v of secretViolations) console.log(`  - ${v}`);
  } else {
    console.log("秘密混入GATE OK(0件)");
  }

  const failed = lint.exit !== 0 || test.exit !== 0 || freezeViolations.length > 0 || secretViolations.length > 0;
  console.log(`\n=== 総合判定: ${failed ? "FAILED" : "OK"} ===`);
  process.exit(failed ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
