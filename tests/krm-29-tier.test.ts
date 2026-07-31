// V3-KRM-29(design19 §T1-6 案A・w-gov3): 3階層は role 文字列を増やさず(requireRole の語彙は
// operator/administrator の2値のまま)、既存3軸貢献度スコアの閾値のみで導出する純関数。
// バッジ=KRM-17称号を再利用(二重に作らない・本テストの対象外)。論文共著権は自動付与しない。
import { describe, expect, it } from "vitest";
import { TruthStore } from "@ihl/truth";
import { tier, tierOf, appendContribution, type Axis } from "../apps/api/src/contribution";
import { canApprove, routeApproval } from "../apps/api/src/gov-routes";
import {
  KRM29_PRO_RESEARCHER_THRESHOLD,
  KRM29_CITIZEN_SCIENTIST_THRESHOLD,
} from "../apps/api/src/economy-constants";
import { FakeR2Bucket } from "./helpers";

const zero: Record<Axis, number> = { research: 0, capital: 0, development: 0 };

describe("V3-KRM-29 tier() pure function", () => {
  it("below every threshold is enjoy", () => {
    expect(tier({ ...zero, research: KRM29_CITIZEN_SCIENTIST_THRESHOLD - 1 })).toBe("enjoy");
  });

  it("any axis at the citizen-scientist threshold is citizen_scientist", () => {
    expect(tier({ ...zero, capital: KRM29_CITIZEN_SCIENTIST_THRESHOLD })).toBe("citizen_scientist");
    expect(tier({ ...zero, development: KRM29_CITIZEN_SCIENTIST_THRESHOLD })).toBe("citizen_scientist");
  });

  it("research at the pro-researcher threshold is pro_researcher even if other axes are 0", () => {
    expect(tier({ ...zero, research: KRM29_PRO_RESEARCHER_THRESHOLD })).toBe("pro_researcher");
  });

  it("capital/development alone never reach pro_researcher regardless of magnitude (research-only gate)", () => {
    expect(tier({ research: 0, capital: 999999, development: 999999 })).toBe("citizen_scientist");
  });

  it("does not mint a new role string (role vocabulary stays operator/administrator elsewhere)", () => {
    const t = tier({ ...zero, research: KRM29_PRO_RESEARCHER_THRESHOLD });
    expect(["pro_researcher", "citizen_scientist", "enjoy"]).toContain(t);
  });
});

describe("V3-KRM-29 tierOf() reads live contribution scores", () => {
  it("derives pro_researcher once research score crosses the threshold via appendContribution", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    expect(await tierOf(s, "researcher-1")).toBe("enjoy");
    await appendContribution(s, "researcher-1", "node-1", "research", KRM29_PRO_RESEARCHER_THRESHOLD, "manual");
    expect(await tierOf(s, "researcher-1")).toBe("pro_researcher");
  });
});

describe("V3-KRM-29 routeApproval()/canApprove()", () => {
  it("paper_coauthor always routes to human regardless of tier (requirement: not auto-granted)", () => {
    expect(routeApproval("pro_researcher", "paper_coauthor")).toBe("human");
    expect(routeApproval("citizen_scientist", "paper_coauthor")).toBe("human");
    expect(routeApproval("enjoy", "paper_coauthor")).toBe("human");
  });

  it("pro_researcher auto-approves other content kinds; lower tiers route to human", () => {
    expect(routeApproval("pro_researcher", "board_post")).toBe("auto");
    expect(routeApproval("citizen_scientist", "board_post")).toBe("human");
    expect(routeApproval("enjoy", "board_post")).toBe("human");
  });

  it("canApprove(s, actorId, contentKind) reads live scores and matches routeApproval(tierOf(...))", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    expect(await canApprove(s, "researcher-2", "board_post")).toBe(false);
    await appendContribution(s, "researcher-2", "node-2", "research", KRM29_PRO_RESEARCHER_THRESHOLD, "manual");
    expect(await canApprove(s, "researcher-2", "board_post")).toBe(true);
    expect(await canApprove(s, "researcher-2", "paper_coauthor")).toBe(false); // never auto, even for pro_researcher
  });
});
