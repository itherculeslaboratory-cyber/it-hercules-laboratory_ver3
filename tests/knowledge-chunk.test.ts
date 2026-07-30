// V3-WIK-18 — mini_chunk(1〜2往復)/theme_chunk(4〜6往復 or 1000トークン)の2階層分割。
import { describe, expect, it } from "vitest";
import { chunkMiniAndTheme, buildSummaryDiff, estimateTokens } from "../apps/api/src/knowledge-chunk";

function turns(n: number, text = "a") {
  return Array.from({ length: n }, (_, i) => ({ turn_id: `t${i}`, raw_text: text }));
}

describe("V3-WIK-18 chunkMiniAndTheme", () => {
  it("splits mini_chunk at 2 turns per chunk", () => {
    const { mini } = chunkMiniAndTheme(turns(5));
    expect(mini).toHaveLength(3); // [t0,t1] [t2,t3] [t4]
    expect(mini[0].turn_ids).toEqual(["t0", "t1"]);
    expect(mini[2].turn_ids).toEqual(["t4"]);
  });

  it("splits theme_chunk at 6 turns when token budget is not exceeded", () => {
    const { theme } = chunkMiniAndTheme(turns(7, "x"));
    expect(theme).toHaveLength(2);
    expect(theme[0].turn_ids).toHaveLength(6);
    expect(theme[1].turn_ids).toHaveLength(1);
  });

  it("splits theme_chunk early when the 1000-token budget is exceeded even under 6 turns", () => {
    const bigText = "a".repeat(2200); // estimateTokens ~1100 > 1000
    const { theme } = chunkMiniAndTheme([{ turn_id: "t0", raw_text: bigText }, { turn_id: "t1", raw_text: "small" }]);
    expect(theme).toHaveLength(2);
    expect(theme[0].turn_ids).toEqual(["t0"]);
    expect(theme[1].turn_ids).toEqual(["t1"]);
  });

  it("every chunk carries empty summary/design_conclusion/embedding slots (filled by a later batch, not here)", () => {
    const { mini, theme } = chunkMiniAndTheme(turns(2));
    for (const c of [...mini, ...theme]) {
      expect(c.summary).toBeNull();
      expect(c.design_conclusion).toBeNull();
      expect(c.embedding).toBeNull();
    }
  });

  it("raw_text joins turn text without alteration", () => {
    const { mini } = chunkMiniAndTheme([{ turn_id: "t0", raw_text: "hello" }, { turn_id: "t1", raw_text: "world" }]);
    expect(mini[0].raw_text).toBe("hello\nworld");
  });
});

describe("V3-WIK-18 buildSummaryDiff", () => {
  it("marks initial when there is no prior summary", () => {
    expect(buildSummaryDiff(null, "first summary").diff_text).toBe("[initial]");
  });
  it("marks unchanged when summary text is identical", () => {
    expect(buildSummaryDiff("same", "same").diff_text).toBe("[unchanged]");
  });
  it("marks changed with before/after when summary differs", () => {
    const d = buildSummaryDiff("old", "new");
    expect(d.diff_text).toContain("old");
    expect(d.diff_text).toContain("new");
  });
});

describe("estimateTokens", () => {
  it("is a deterministic length-based approximation (no external tokenizer)", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("ab")).toBe(1);
    expect(estimateTokens("abcd")).toBe(2);
  });
});
