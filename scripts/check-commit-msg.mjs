#!/usr/bin/env node
// GATE: commit-message discipline (V3-AIP-36). A commit subject must read
//   [post_id] 変更理由 → 変更内容 → 影響範囲
// and the body must carry the intent-meta trailer (five keys) so every change is
// traceable to its 意図台帳 entry.
//
// Two carve-outs from §1.8 / §5:
//   - Commits before BASELINE_REF (= the C6 start commit) are out of scope — this
//     discipline applies from C6 onward, so the whole C0..C5 history is exempt.
//     BASELINE_REF is null until C6 starts; while null the gate is a no-op.
//   - post_id は K6 知の広場 (BBS) の実装依存。K6 未達の間は post_id 欠落を warning
//     に留める (fatal にしない)。
//
// parseCommitMsg(message) and filterCommitsInScope(commits, baselineRef) are
// exported so guards.test.ts can drive them with synthetic input — no git needed.
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Set to the C6 start commit SHA when C6 begins (§1.8 凍結定数). null = gate off.
export const BASELINE_REF = null;

export const INTENT_META_KEYS = [
  "intent_summary",
  "problem_statement",
  "expected_effect",
  "rejected_alternatives",
  "decision_source",
];

const SUBJECT_RE = /^\[([^\]]*)\]\s*(.+)$/;
const ARROW = "→"; // →

/**
 * Validate one commit message.
 * @returns {{ ok: boolean, violations: string[], warnings: string[] }}
 *   ok is false only when there is a fatal violation; a null/empty post_id is a
 *   warning (K6 dependency), not a violation.
 */
export function parseCommitMsg(message) {
  const violations = [];
  const warnings = [];
  const lines = String(message).split(/\r?\n/);
  const subject = lines[0] ?? "";

  const m = SUBJECT_RE.exec(subject);
  if (!m) {
    violations.push("subject missing [post_id] prefix");
  } else {
    const postId = m[1].trim();
    if (postId === "" || postId.toLowerCase() === "null") {
      warnings.push("post_id is null (K6 知の広場 未実装 — nullable warn)");
    }
    const parts = m[2].split(ARROW).map((s) => s.trim());
    if (parts.length !== 3 || parts.some((p) => p === "")) {
      violations.push(`subject must be "変更理由 ${ARROW} 変更内容 ${ARROW} 影響範囲"`);
    }
  }

  const body = lines.slice(1).join("\n");
  for (const key of INTENT_META_KEYS) {
    const re = new RegExp(`^${key}:\\s*\\S`, "m");
    if (!re.test(body)) violations.push(`missing intent-meta trailer: ${key}`);
  }

  return { ok: violations.length === 0, violations, warnings };
}

/**
 * Keep only commits at/after baselineRef. commits are ordered oldest→newest.
 * baselineRef null → [] (gate off, pre-C6). baselineRef not found → all commits
 * (the list is already the post-baseline range, e.g. `git log BASELINE..HEAD`).
 */
export function filterCommitsInScope(commits, baselineRef) {
  if (baselineRef == null) return [];
  const idx = commits.findIndex((c) => c.sha === baselineRef);
  return idx === -1 ? commits.slice() : commits.slice(idx);
}

function gitCommits(baselineRef) {
  // oldest→newest with a NUL record separator so bodies with blank lines survive.
  const range = baselineRef ? `${baselineRef}..HEAD` : "HEAD";
  const raw = execSync(`git log --reverse --format=%H%x1f%B%x1e ${range}`, { encoding: "utf8" });
  return raw
    .split("\x1e")
    .map((r) => r.replace(/^\n/, ""))
    .filter((r) => r.trim())
    .map((r) => {
      const [sha, ...rest] = r.split("\x1f");
      return { sha: sha.trim(), message: rest.join("\x1f") };
    });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (BASELINE_REF == null) {
    console.log("commit-msg GATE: BASELINE_REF not set (pre-C6) — gate off.");
    process.exit(0);
  }
  const inScope = filterCommitsInScope(gitCommits(BASELINE_REF), BASELINE_REF);
  const failures = [];
  for (const c of inScope) {
    const r = parseCommitMsg(c.message);
    for (const w of r.warnings) console.warn(`  warn ${c.sha.slice(0, 8)}: ${w}`);
    if (!r.ok) failures.push(`${c.sha.slice(0, 8)}: ${r.violations.join("; ")}`);
  }
  if (failures.length === 0) {
    console.log("commit-msg GATE OK.");
    process.exit(0);
  }
  console.error("commit-msg GATE FAILED:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
