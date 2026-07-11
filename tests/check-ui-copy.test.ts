// V3-UIX-01 — no "unimplemented / WIP" copy in user-facing UI. scanCopy detects
// each forbidden word; the real UI copy surfaces (screen-defs/apps-web-src/i18n)
// are clean.
import { describe, expect, it } from "vitest";
import { scanCopy, runGate, FORBIDDEN_UI_WORDS } from "../scripts/check-ui-copy.mjs";
import { fileURLToPath } from "node:url";

// vitest cwd = tests/; the gate reads UI surfaces relative to the repo root.
const ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("V3-UIX-01 check-ui-copy", () => {
  it("flags every forbidden word (CJK + ASCII)", () => {
    for (const w of FORBIDDEN_UI_WORDS) {
      // embed the word in surrounding copy so it isn't the whole string
      expect(scanCopy(`案内: ${w} です`), w).toContain(w);
    }
  });

  it("detects a forbidden word inside real screen-def-shaped copy", () => {
    expect(scanCopy("この画面は準備中です")).toContain("準備中");
    expect(scanCopy("Feature coming soon to the app")).toContain("coming soon");
    expect(scanCopy("// TODO: wire this")).toContain("TODO");
  });

  it("passes clean UI copy (no false positives on real words)", () => {
    expect(scanCopy("設定を保存する")).toEqual([]);
    expect(scanCopy("Save settings and continue")).toEqual([]);
    // ASCII boundary: 'WIP' must not fire inside 'swiped', 'TODO' not in 'todos-lib'
    expect(scanCopy("he swiped the card")).toEqual([]);
    expect(scanCopy("import todos-lib")).toEqual([]);
  });

  it("the real UI copy surfaces contain no forbidden words", () => {
    expect(runGate(ROOT)).toEqual([]);
  });
});
