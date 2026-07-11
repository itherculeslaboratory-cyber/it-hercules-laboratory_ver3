#!/usr/bin/env node
// GATE: secret leak (V3-SEC-04). Scans git-tracked text files for PEM private-key
// blocks and Resend / OpenAI / AWS key shapes, and flags any tracked real `.env`
// (only `.env.example`, the type-only template, may be committed).
// scanText(text) is exported so the negative TC can assert detection directly.
// ponytail: placeholder tokens (a char run of 6+, e.g. .env.example's
// `re_xxxx…`) are ignored — a real high-entropy key never repeats one char six
// times. Adjust isPlaceholder here if a real key ever false-negatives.
import { readFileSync, existsSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SECRET_PATTERNS = [
  { type: "PEM_PRIVATE_KEY", re: /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g },
  { type: "RESEND_KEY", re: /\bre_[A-Za-z0-9]{16,}\b/g },
  { type: "OPENAI_KEY", re: /\bsk-[A-Za-z0-9]{16,}\b/g },
  { type: "AWS_ACCESS_KEY", re: /\bAKIA[0-9A-Z]{16}\b/g },
];

function isPlaceholder(token) {
  return /(.)\1{5,}/.test(token);
}

/** Return the secret types found in `text` (placeholders excluded). */
export function scanText(text) {
  const out = [];
  for (const { type, re } of SECRET_PATTERNS) {
    for (const m of text.matchAll(re)) {
      if (isPlaceholder(m[0])) continue;
      out.push(type);
    }
  }
  return out;
}

// Files/dirs exempt from the GATE: this scanner + sibling tools/tests that
// carry intentional key-shaped literals (fixtures, key-derivation docs), the
// type-only template, and build/vendor trees.
const EXCLUDE_FILES = new Set([
  ".env.example",
  "scripts/check-secrets.mjs",
  "scripts/pii-scan.mjs",
  "scripts/derive-collector-pubkey.mjs",
  "apps/api/src/pii.mjs",
  "apps/api/src/pii.d.ts",
  "tests/pii.test.ts",
  "tests/pii-scan.test.ts",
  "tests/check-secrets.test.ts",
  "tests/check-cron.test.ts",
  "tests/check-navigation.test.ts",
  "tests/derive-collector-pubkey.test.ts",
  "tests/cl-09-ed25519.test.ts",
]);
const EXCLUDE_DIRS = ["node_modules/", ".git/", "dist/", ".next/", "generated/", "tests/fixtures/"];
// Tracked real dotenv files (anything named `.env` or `.env.<x>` that is not the template).
const REAL_ENV = /(^|\/)\.env(\.[^/]+)?$/;

function trackedFiles() {
  return execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
}

function runGate() {
  const violations = [];
  for (const rel of trackedFiles()) {
    if (EXCLUDE_FILES.has(rel) || EXCLUDE_DIRS.some((d) => rel.startsWith(d) || rel.includes("/" + d))) continue;
    if (REAL_ENV.test(rel) && rel !== ".env.example") {
      violations.push(`tracked real dotenv file: ${rel}`);
      continue;
    }
    const full = join(process.cwd(), rel);
    if (!existsSync(full) || statSync(full).isDirectory()) continue;
    let text;
    try {
      text = readFileSync(full, "utf8");
    } catch {
      continue; // binary / unreadable — skip
    }
    for (const type of scanText(text)) violations.push(`${rel}: ${type}`);
  }
  return violations;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const violations = runGate();
  if (violations.length) {
    console.error("secrets GATE FAILED:");
    for (const v of violations) console.error("  - " + v);
    process.exit(1);
  }
  console.log("secrets GATE OK");
}
