// V3-AIP-28: weighted scorecard gate — total AND per-axis minimums must both pass.
import { describe, expect, it } from "vitest";
import { evaluateScorecard, loadPreset } from "../scripts/scorecard-gate.mjs";

describe("V3-AIP-28 evaluateScorecard(total + per-axis minimums)", () => {
  const axes = [
    { name: "A-completeness", maxPoints: 30, score: 30 },
    { name: "B-layer-separation", maxPoints: 30, min: 25, score: 30 },
    { name: "C-code-fidelity", maxPoints: 30, min: 25, score: 30 },
    { name: "D-rtm", maxPoints: 10, score: 10 },
  ];

  it("passes when total >= totalMin and every axis minimum is met", () => {
    const result = evaluateScorecard(axes, 85);
    expect(result.pass).toBe(true);
    expect(result.total).toBe(100);
    expect(result.violations).toEqual([]);
  });

  it("fails on total shortfall even if every axis minimum is met", () => {
    const low = axes.map((a) => ({ ...a, score: Math.round(a.maxPoints * 0.5) }));
    const result = evaluateScorecard(low, 85);
    expect(result.pass).toBe(false);
    expect(result.violations.some((v) => v.includes("below totalMin"))).toBe(true);
  });

  it("fails when total >= totalMin but a per-axis minimum is not met (the whole point of this gate)", () => {
    // total = 30(A) + 20(B, below min 25) + 30(C) + 10(D) = 90 >= 85, but B misses its floor.
    const failing = [
      { name: "A-completeness", maxPoints: 30, score: 30 },
      { name: "B-layer-separation", maxPoints: 30, min: 25, score: 20 },
      { name: "C-code-fidelity", maxPoints: 30, min: 25, score: 30 },
      { name: "D-rtm", maxPoints: 10, score: 10 },
    ];
    const result = evaluateScorecard(failing, 85);
    expect(result.total).toBe(90);
    expect(result.pass).toBe(false);
    expect(result.violations.some((v) => v.includes("B-layer-separation"))).toBe(true);
  });

  it("flags an out-of-range axis score", () => {
    const bad = [{ name: "X", maxPoints: 10, score: 15 }];
    const result = evaluateScorecard(bad, 0);
    expect(result.violations.some((v) => v.includes("out of range"))).toBe(true);
  });
});

describe("V3-AIP-28 config/scorecard-presets.json", () => {
  it("both presets' axis maxPoints sum to 100", () => {
    for (const name of ["weighted-3axis", "abcd-rtm"]) {
      const preset = loadPreset(name);
      const sum = preset.axes.reduce((s, a) => s + a.maxPoints, 0);
      expect(sum, `${name}: axis maxPoints must sum to 100`).toBe(100);
    }
  });

  it("abcd-rtm preset matches the requirement example (totalMin 85, B/C min 25)", () => {
    const preset = loadPreset("abcd-rtm");
    expect(preset.totalMin).toBe(85);
    const b = preset.axes.find((a) => a.name === "B-layer-separation");
    const c = preset.axes.find((a) => a.name === "C-code-fidelity");
    expect(b.min).toBe(25);
    expect(c.min).toBe(25);
  });
});
