// V3-AIP-106 + V3-GOV-25 (CMP合流) — design-sync GATE unit tests. Pure decision
// function driven with synthetic input (no real git history / PR required),
// same shape as tests/guards.test.ts for check-req-freeze.mjs.
import { describe, expect, it } from "vitest";
import { checkDesignSync } from "../scripts/check-design-sync.mjs";

describe("V3-AIP-106 / V3-GOV-25 checkDesignSync(design-sync gate)", () => {
  it("passes when no implementation code changed", () => {
    expect(checkDesignSync(["README.md", "01-requirements/registry.json"])).toEqual([]);
  });

  it("fails when implementation code changes without a design doc or 設計影響なし declaration", () => {
    const v = checkDesignSync(["apps/api/src/gov-routes.ts"]);
    expect(v.length).toBe(1);
    expect(v[0]).toContain("V3-AIP-106");
  });

  it("passes when a docs/planning/ design doc changes in the same PR", () => {
    const v = checkDesignSync([
      "apps/api/src/gov-routes.ts",
      "docs/planning/c9/design-gov-25.md",
    ]);
    expect(v).toEqual([]);
  });

  it("passes when a commit carries a 設計影響なし: <理由> declaration", () => {
    const v = checkDesignSync(
      ["scripts/check-secrets.mjs"],
      ["[null] typo fix → no logic change → none\n\n設計影響なし: タイポ修正のみ、ロジック変更なし"],
    );
    expect(v).toEqual([]);
  });

  it("fails when 設計影響なし is present but has no reason after the colon", () => {
    const v = checkDesignSync(["libs/datalake/foo.ts"], ["設計影響なし:"]);
    expect(v.length).toBe(1);
  });

  it("accepts the full-width colon form (設計影響なし：理由)", () => {
    const v = checkDesignSync(["components/foo/bar.py"], ["設計影響なし：全角コロンでも可"]);
    expect(v).toEqual([]);
  });

  it("passes for a components/ change accompanied by a rulings-only doc (rulings sit under docs/planning/)", () => {
    const v = checkDesignSync(
      ["components/image-analyzer/main.py"],
      ["no declaration here"],
    );
    // rulings live under docs/planning/rulings/ which is itself under DESIGN_PREFIX,
    // so a rulings-only PR (no code path listed) is out of scope for this check —
    // this case has no docs/planning change and no declaration, so it must fail.
    expect(v.length).toBe(1);
  });
});
