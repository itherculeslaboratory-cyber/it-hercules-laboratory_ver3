// V3-CST-02 — ランニングコスト透明性ダッシュボード。computeR2Cost/computeCostsSummary
// の純関数境界値 + GET /api/v1/costs のルート統合(protected・ログイン済み全ユーザー
// 閲覧可)を検証する。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { DEV_TOKEN, makeEnv } from "./helpers";
import { computeR2Cost, computeCostsSummary, type R2Pricing, type RunningCostsConfig } from "../apps/api/src/costs-routes";

const PRICING: R2Pricing = {
  free_storage_gb: 10,
  storage_yen_per_gb_month: 2.5,
  free_class_a_ops_per_month: 1_000_000,
  class_a_yen_per_million_ops: 675,
  free_class_b_ops_per_month: 10_000_000,
  class_b_yen_per_million_ops: 54,
};

const CONFIG: RunningCostsConfig = {
  currency: "JPY",
  vps: { label: "Sakura VPS", monthly_yen: 500, source: "manual" },
  r2: { manual_override_yen: 0, pricing: PRICING },
};

describe("V3-CST-02 computeR2Cost (free tier subtracted, floor 0)", () => {
  it("usage entirely within the free tier costs 0", () => {
    expect(computeR2Cost({ storage_gb: 5, class_a_ops: 100, class_b_ops: 100 }, PRICING)).toBe(0);
  });

  it("storage over the free tier is billed per GB-month", () => {
    // 10 GB free + 4 GB billable * 2.5 yen = 10
    expect(computeR2Cost({ storage_gb: 14, class_a_ops: 0, class_b_ops: 0 }, PRICING)).toBe(10);
  });

  it("class A/B ops over the free tier are billed per million ops", () => {
    const usage = {
      storage_gb: 0,
      class_a_ops: 1_000_000 + 2_000_000, // 2M billable * 675 = 1350
      class_b_ops: 10_000_000 + 5_000_000, // 5M billable * 54 = 270
    };
    expect(computeR2Cost(usage, PRICING)).toBe(1350 + 270);
  });
});

describe("V3-CST-02 computeCostsSummary", () => {
  it("falls back to manual_override_yen when r2Usage is undefined", () => {
    const summary = computeCostsSummary({ ...CONFIG, r2: { manual_override_yen: 42, pricing: PRICING } });
    expect(summary.r2).toEqual({ monthly_yen: 42, source: "manual" });
    expect(summary.total_monthly_yen).toBe(500 + 42);
  });

  it("uses live R2 usage (source:'api') when provided", () => {
    const summary = computeCostsSummary(CONFIG, { storage_gb: 14, class_a_ops: 0, class_b_ops: 0 });
    expect(summary.r2.source).toBe("api");
    expect(summary.r2.monthly_yen).toBe(10);
    expect(summary.total_monthly_yen).toBe(510);
  });

  it("includes currency + vps passthrough unchanged", () => {
    const summary = computeCostsSummary(CONFIG);
    expect(summary.currency).toBe("JPY");
    expect(summary.vps).toEqual(CONFIG.vps);
  });
});

describe("V3-CST-02 GET /api/v1/costs route", () => {
  it("401 AUTH_REQUIRED without a session (deny-by-default, CL-04)", async () => {
    const res = await app.request("/api/v1/costs", {}, makeEnv());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "AUTH_REQUIRED" });
  });

  it("any logged-in user can view it (no extra role gate) and gets a well-formed summary", async () => {
    const res = await app.request(
      "/api/v1/costs",
      { headers: { authorization: `Bearer ${DEV_TOKEN}` } },
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.currency).toBe("JPY");
    expect(typeof body.total_monthly_yen).toBe("number");
    expect(body.r2.source).toBe("manual"); // no CF_API_TOKEN in test env -> degrade
  });
});
