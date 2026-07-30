// V3-CST-03 — AI運用コストの3層モデルルーティング表(machine-readable化)の検証。
// V3-FND-33 — 段階的リリース設計(観測/マーケット/認証=必須、演出機能は後回し)の検証。
import { describe, expect, it } from "vitest";
import {
  MODEL_ROUTING_TABLE,
  routeModelForTask,
  RELEASE_REQUIRED_DOMAINS,
  isReleaseRequiredDomain,
} from "../apps/api/src/costs-routes";

describe("V3-CST-03 MODEL_ROUTING_TABLE / routeModelForTask", () => {
  it("has all 4 tiers with model+effort per CLAUDE.md 4層表", () => {
    expect(MODEL_ROUTING_TABLE.orchestration.model).toBe("claude-opus-5");
    expect(MODEL_ROUTING_TABLE.implementation.model).toBe("claude-sonnet-5");
    expect(MODEL_ROUTING_TABLE.mechanical.model).toBe("claude-haiku-4-5");
    expect(MODEL_ROUTING_TABLE.ceiling.model).toBe("claude-fable-5");
  });

  it("routes orchestration/review tasks to the orchestration tier", () => {
    expect(routeModelForTask("orchestration")).toBe("orchestration");
    expect(routeModelForTask("review")).toBe("orchestration");
  });

  it("routes judgment-free mechanical tasks to the mechanical tier", () => {
    expect(routeModelForTask("mechanical")).toBe("mechanical");
  });

  it("routes a genuinely-stuck task to the ceiling tier (Fable, 指名制)", () => {
    expect(routeModelForTask("deep-stuck")).toBe("ceiling");
  });

  it("defaults unknown/implementation/research tasks to implementation (safe default)", () => {
    expect(routeModelForTask("implementation")).toBe("implementation");
    expect(routeModelForTask("research")).toBe("implementation");
  });
});

describe("V3-FND-33 RELEASE_REQUIRED_DOMAINS / isReleaseRequiredDomain", () => {
  it("obs/mkt/aut are release-required (R2+Kernelだけで動く最小集合)", () => {
    expect(isReleaseRequiredDomain("obs")).toBe(true);
    expect(isReleaseRequiredDomain("mkt")).toBe(true);
    expect(isReleaseRequiredDomain("aut")).toBe(true);
  });

  it("decorative/deferred domains (4D viewer, video) are not release-required", () => {
    expect(isReleaseRequiredDomain("ui-4d-viewer")).toBe(false);
    expect(isReleaseRequiredDomain("vid")).toBe(false);
  });

  it("RELEASE_REQUIRED_DOMAINS is exactly the 3-domain minimal set", () => {
    expect([...RELEASE_REQUIRED_DOMAINS].sort()).toEqual(["aut", "mkt", "obs"]);
  });
});
