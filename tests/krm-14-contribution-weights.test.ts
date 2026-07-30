// V3-KRM-14(直接貢献/間接貢献の重みテーブル)。★正直な部分実装: 重みテーブルと
// lookup 関数のみを検証する。実際の付与呼び出し箇所(paper-match-routes.ts /
// individual-routes.ts=w1-ind所有glob)への配線はこのラウンドの対象外(発注書の
// 「書いてよい場所」外・報告書に明記)。
import { describe, expect, it } from "vitest";
import {
  DIRECT_CONTRIBUTION_WEIGHTS,
  INDIRECT_CONTRIBUTION_WEIGHTS,
  contributionWeightFor,
} from "../apps/api/src/contribution-constants";

describe("V3-KRM-14 direct/indirect contribution weight table", () => {
  it("direct weights match the sourced values (paper=50, specimen=20)", () => {
    expect(DIRECT_CONTRIBUTION_WEIGHTS.paper).toBe(50);
    expect(DIRECT_CONTRIBUTION_WEIGHTS.specimen).toBe(20);
  });

  it("indirect weight matches the sourced value (specimen_searched=1)", () => {
    expect(INDIRECT_CONTRIBUTION_WEIGHTS.specimen_searched).toBe(1);
  });

  it("contributionWeightFor resolves direct vs indirect correctly", () => {
    expect(contributionWeightFor("paper", true)).toBe(50);
    expect(contributionWeightFor("specimen", true)).toBe(20);
    expect(contributionWeightFor("specimen_searched", false)).toBe(1);
  });
});
