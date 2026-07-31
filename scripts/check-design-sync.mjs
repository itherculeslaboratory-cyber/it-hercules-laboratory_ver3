#!/usr/bin/env node
// GATE: design-sync (V3-AIP-106 + V3-GOV-25 変更管理プロトコル(CMP)を合流させた
// 実装。design35 §3 A-3 の指示どおり別立てにしない).
//
// 要件逐語(AIP-106): 「実装コードを変更するPRは、対応する設計書§の同時更新、または
// 理由付きの『設計影響なし』宣言を必須とし、CIで機械検査する(check-req-freeze.mjsと
// 同型のゲート)」
// 要件逐語(GOV-25・変更管理プロトコル/CMP): 「仕様変更は『変更理由の明文化→仕様書
// 更新→…』を必ず経る。理由…が曖昧な変更を禁止」
//
// この2件は「実装コード変更には設計文書の追随、または理由の明文化が要る」という同一
// の骨格を持つため1ゲートに統合する。GOV-25の拡張7要素(Intent Schema/CCM等)や
// 掲示板投稿↔commit_sha紐付けはこのゲート単体では検査できない範囲であり実装していない
// (report参照・in_progressのまま持ち越す)。
//
// mjs-ification パターンは check-req-freeze.mjs と同型: pure decision function
// (checkDesignSync)を export し、guards test はこれを合成入力で駆動する。
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// 実装コードとみなすprefix(このリポジトリのapps/libs/components/scripts)。
const CODE_PREFIXES = ["apps/api/src/", "apps/web/src/", "components/", "libs/", "scripts/"];
const DESIGN_PREFIX = "docs/planning/";
// 「設計影響なし: <理由>」の全角/半角コロン両対応。
const NO_IMPACT_RE = /設計影響なし[:：]\s*\S/;

/**
 * @param {string[]} changedFiles repo-relative paths changed in the PR.
 * @param {string[]} commitMessages このPRに含まれる全コミットメッセージ(件名+本文)。
 * @returns {string[]} violations ([] = ok)。
 */
export function checkDesignSync(changedFiles, commitMessages = []) {
  const norm = changedFiles.map((f) => f.replace(/\\/g, "/"));
  const codeChanged = norm.filter((f) => CODE_PREFIXES.some((p) => f.startsWith(p)));
  if (codeChanged.length === 0) return [];

  const designChanged = norm.some((f) => f.startsWith(DESIGN_PREFIX));
  if (designChanged) return [];

  const hasNoImpactDeclaration = commitMessages.some((m) => NO_IMPACT_RE.test(String(m)));
  if (hasNoImpactDeclaration) return [];

  return [
    `implementation code changed (${codeChanged.length} files: ${codeChanged.slice(0, 5).join(", ")}${codeChanged.length > 5 ? ", ..." : ""}) ` +
      `without a ${DESIGN_PREFIX} update and no "設計影響なし: <理由>" declaration in any commit message (V3-AIP-106 / V3-GOV-25).`,
  ];
}

function changedFilesFromGit(base, head) {
  const out = execSync(`git diff --name-only ${base} ${head}`, { encoding: "utf8" });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

function commitMessagesFromGit(base, head) {
  const raw = execSync(`git log --format=%B%x1e ${base}..${head}`, { encoding: "utf8" });
  return raw.split("\x1e").map((s) => s.trim()).filter(Boolean);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const base = process.env.BASE_SHA;
  const head = process.env.HEAD_SHA ?? "HEAD";
  if (!base) {
    console.log("design-sync GATE: no BASE_SHA — not a PR context, skipped.");
    process.exit(0);
  }
  const changed = changedFilesFromGit(base, head);
  const commits = commitMessagesFromGit(base, head);
  const violations = checkDesignSync(changed, commits);
  if (violations.length === 0) {
    console.log("design-sync GATE OK.");
    process.exit(0);
  }
  console.error("design-sync GATE FAILED:");
  for (const v of violations) console.error("  - " + v);
  process.exit(1);
}
