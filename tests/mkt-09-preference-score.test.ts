// V3-MKT-09 マーケット既定ソート「好み新着順」: score=Σ(weight[tag]×normalizedValue[tag])。
// 重み(weight)自体は round-19裁定で確定していない可変値のため、この純関数は重みを
// ハードコードせず引数として受け取る(呼び出し側=将来のGUI/フォーク由来)。
import { describe, expect, it } from "vitest";
import { computePreferenceScore, preferenceHighlights } from "../apps/api/src/market-settlement";

describe("V3-MKT-09 好み新着順スコア", () => {
  it("数値タグは(value-min)/(max-min)で正規化する", () => {
    const { score, matchPercent } = computePreferenceScore(
      { size: { kind: "numeric", weight: 1, min: 0, max: 100 } },
      { size: 50 },
    );
    expect(score).toBeCloseTo(0.5);
    expect(matchPercent).toBe(50);
  });

  it("カテゴリタグは呼び出し側が算出した一致度(1/0.5/0)をそのまま使う", () => {
    const { score } = computePreferenceScore(
      { color: { kind: "category", weight: 2, categoryMatch: 1 } },
      {},
    );
    expect(score).toBe(2);
  });

  it("価格タグは 1-(price/maxPrice) で正規化する(安いほど高スコア)", () => {
    const { score } = computePreferenceScore(
      { price: { kind: "price", weight: 1, max: 1000 } },
      { price: 800 },
    );
    expect(score).toBeCloseTo(0.2);
  });

  it("複数タグの重み付き合算・一致度%は重みの合計に対する比率", () => {
    const specs = {
      size: { kind: "numeric" as const, weight: 3, min: 0, max: 10 },
      color: { kind: "category" as const, weight: 1, categoryMatch: 0.5 as const },
    };
    const { score, matchPercent, tagContributions } = computePreferenceScore(specs, { size: 10 });
    // size: 3 * 1.0 = 3 / color: 1 * 0.5 = 0.5 / 合計 3.5 / 重み合計 4 → 87.5% → round 88
    expect(score).toBeCloseTo(3.5);
    expect(matchPercent).toBe(88);
    expect(tagContributions.size).toBeCloseTo(3);
    expect(tagContributions.color).toBeCloseTo(0.5);
  });

  it("重み未設定(空specs)はscore=0・matchPercent=0", () => {
    const { score, matchPercent } = computePreferenceScore({}, {});
    expect(score).toBe(0);
    expect(matchPercent).toBe(0);
  });

  it("良い点/惜しい点は寄与度の最大/最小タグ名を返す", () => {
    const { strongestTag, weakestTag } = preferenceHighlights({ size: 3, color: 0.5, freshness: -1 });
    expect(strongestTag).toBe("size");
    expect(weakestTag).toBe("freshness");
  });
});
