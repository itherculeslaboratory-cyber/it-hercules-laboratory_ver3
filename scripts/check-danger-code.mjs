#!/usr/bin/env node
// GATE: dangerous-code classifier (V3-AIP-68 — staging 昇格の物理ゲート). A PR diff
// that adds money-moving API calls, DNS / domain-registrar operations, self-
// permission changes, or a one-click/auto-approve bypass of a human gate
// (V3-AIP-31 — ワンクリック全自動禁止・自動処理は opt-in) must not sail through
// unreviewed: the gate fails so a human runs the staging-promotion review
// (10 人規模レビュー・試験運用は人間運用ゲート・§5).
//
// Only ADDED lines are classified (removing dangerous code is fine). The input may
// be a real unified diff or a plain snippet. classifyDangerousDiff(diffText) is
// exported so guards.test.ts can drive it with adversarial samples — no git.
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// category → patterns that, if added, require the human staging gate.
const DANGER_PATTERNS = [
  {
    category: "money-api",
    res: [
      /\b(createTransfer|executeTransfer|requestTransfer|payout|withdraw|remit)\s*\(/i,
      /["'`]\/?(?:v\d+\/)?transfers\b/i,
      /gmo[-.]?aozora/i,
      /sunabar[\s\S]{0,40}transfer/i,
    ],
  },
  {
    category: "dns-domain",
    res: [
      /\bdns_records\b/i,
      /\broute53\b/i,
      /changeResourceRecordSets/i,
      /zones\/[^/\s]+\/dns_records/i,
      /\bregistrar\b/i,
      /cloudflare[\s\S]{0,40}(?:dns|zone)/i,
    ],
  },
  {
    // 自己（AI）権限変更: editing one's own permission/sandbox governance. Scoped to
    // the governance markers — generic shell sudo/chmod in ops runbooks is NOT this
    // (it flooded doc diffs with false positives; deployment privilege ≠ AI 自己権限).
    category: "self-permission",
    res: [
      /permissions\.allow/,
      /bypassPermissions/,
      /dangerouslyDisableSandbox/i,
      /\.claude[\\/]settings/,
    ],
  },
  {
    // ワンクリック全自動・人間ゲートの機械的バイパス(V3-AIP-31)。「候補を示し人間が選ぶ」を
    // 崩す identifier — 承認/確認ステップを飛ばす関数・フラグの新規追加を検出する。
    category: "auto-gate-bypass",
    res: [
      /\bauto[_-]?[Aa]pprove\b/,
      /\bskip[_-]?[Hh]uman[_-]?[Gg]ate\b/,
      /\bbypass[_-]?[Hh]uman[_-]?[Gg]ate\b/,
      /\bone[_-]?[Cc]lick[_-]?[Dd]eploy\b/,
      /\bno[_-]?[Cc]onfirm[_-]?[Rr]equired\b/,
      /\bfully[_-]?[Aa]utomatic\b/,
    ],
  },
];

function addedLines(diffText) {
  const out = [];
  for (const raw of String(diffText).split(/\r?\n/)) {
    if (/^(\+\+\+|---|@@|diff |index )/.test(raw)) continue; // diff metadata
    if (raw.startsWith("-")) continue; // removed line — not a new hazard
    out.push(raw.startsWith("+") ? raw.slice(1) : raw); // strip added marker if present
  }
  return out;
}

/**
 * @param {string} diffText unified diff or plain snippet.
 * @returns {{ category: string, evidence: string }[]} findings ([] = clean).
 */
export function classifyDangerousDiff(diffText) {
  const findings = [];
  for (const line of addedLines(diffText)) {
    for (const { category, res } of DANGER_PATTERNS) {
      const hit = res.find((re) => re.test(line));
      if (hit) findings.push({ category, evidence: line.trim().slice(0, 120) });
    }
  }
  return findings;
}

function gitDiff() {
  const base = process.env.BASE_SHA;
  const head = process.env.HEAD_SHA ?? "HEAD";
  if (!base) return null;
  return execSync(`git diff ${base} ${head}`, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const diff = gitDiff();
  if (diff == null) {
    console.log("danger-code GATE: no BASE_SHA — not a PR context, skipped.");
    process.exit(0);
  }
  const findings = classifyDangerousDiff(diff);
  if (findings.length === 0) {
    console.log("danger-code GATE OK.");
    process.exit(0);
  }
  console.error("danger-code GATE FAILED — 危険コード検出 (staging 昇格は人間ゲート):");
  for (const f of findings) console.error(`  - [${f.category}] ${f.evidence}`);
  process.exit(1);
}
