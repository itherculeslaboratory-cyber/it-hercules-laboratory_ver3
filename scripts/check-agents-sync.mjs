#!/usr/bin/env node
// GATE: CLAUDE.md <-> AGENTS.md sync (folder design §4.2 / §8 step 7e)
// Contract (writer B owns the files, this checks them):
//   line 1  == "> 正本は AGENTS.md — 本ファイルは同内容複製(CI 同期チェック対象)。"
//   line 2  == "" (blank)
//   line 3+ == full text of AGENTS.md, byte-for-byte
// AGENTS.md absent => repo not bootstrapped yet => pass. Node-only, zero dependencies.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const agentsPath = join(ROOT, "AGENTS.md");
const claudePath = join(ROOT, "CLAUDE.md");
const DECLARATION = "> 正本は AGENTS.md — 本ファイルは同内容複製(CI 同期チェック対象)。";

if (!existsSync(agentsPath)) {
  console.log("agents-sync OK (AGENTS.md not present yet — skipped)");
  process.exit(0);
}
if (!existsSync(claudePath)) {
  console.error("agents-sync FAILED: AGENTS.md exists but CLAUDE.md is missing");
  process.exit(1);
}

// Normalize CRLF -> LF so the check is line-ending agnostic.
const agents = readFileSync(agentsPath, "utf8").replace(/\r\n/g, "\n");
const claude = readFileSync(claudePath, "utf8").replace(/\r\n/g, "\n");
const expected = DECLARATION + "\n\n" + agents;

if (claude !== expected) {
  console.error("agents-sync FAILED: CLAUDE.md must be the declaration line + blank line + AGENTS.md verbatim.");
  console.error("  expected line 1: " + DECLARATION);
  console.error("  actual   line 1: " + claude.split("\n")[0]);
  process.exit(1);
}
console.log("agents-sync OK");
