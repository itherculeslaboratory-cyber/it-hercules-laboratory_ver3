#!/usr/bin/env node
// V3-AIP-28: weighted machine scorecard gate. 成果物はスコアカードで加重機械採点し、
// 合計点だけでなく各軸の最低点も同時に満たすことをゲート合格条件とする。
//
// This module implements the GATE MECHANISM only (a pure, testable function).
// It does not — and cannot — assign the axis scores itself: scoring a real
// deliverable (structural completeness, design fulfillment, UX, code fidelity,
// etc.) is a critic-gate judgment call (人間/批評家 or an upstream LLM rubric
// pass), not something this script fabricates. Presets (weight/maxPoints split
// per axis) live in config/scorecard-presets.json and are illustrative examples
// from the requirement text, not the only allowed scheme (Best-of-N).
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// Repo root, resolved from this file's own location — NOT process.cwd(). Callers
// (tests/, apps/api, apps/web) are each their own npm workspace with a different
// cwd when `npm test` runs them, so cwd-based lookup silently breaks outside the
// repo root.
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");

/**
 * @param {{ name: string, maxPoints: number, score: number, min?: number }[]} axes
 * @param {number} totalMin
 * @returns {{ total: number, max: number, pass: boolean, violations: string[] }}
 */
export function evaluateScorecard(axes, totalMin) {
  const violations = [];
  let total = 0;
  let max = 0;
  for (const axis of axes) {
    if (axis.score < 0 || axis.score > axis.maxPoints) {
      violations.push(`${axis.name}: score ${axis.score} out of range [0, ${axis.maxPoints}]`);
    }
    total += axis.score;
    max += axis.maxPoints;
    if (typeof axis.min === "number" && axis.score < axis.min) {
      violations.push(`${axis.name}: score ${axis.score} below axis minimum ${axis.min}`);
    }
  }
  if (total < totalMin) {
    violations.push(`total ${total} below totalMin ${totalMin}`);
  }
  return { total, max, pass: violations.length === 0, violations };
}

/** Load a named preset from config/scorecard-presets.json (repo-root relative). */
export function loadPreset(name, root = REPO_ROOT) {
  const presets = JSON.parse(readFileSync(join(root, "config", "scorecard-presets.json"), "utf8"));
  const preset = presets[name];
  if (!preset) throw new Error(`unknown scorecard preset: ${name}`);
  return preset;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  console.log(
    "scorecard-gate.mjs exports evaluateScorecard(axes, totalMin) + loadPreset(name).\n" +
      "This is a library for the critic-gate step (V3-AIP-28) — it has no standalone CLI mode\n" +
      "because axis scores must come from an actual deliverable review, not this script.",
  );
}
