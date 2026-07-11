// MKT-36 手数料/拠出の純関数 TC。3% 文明拠出 / 8% 維持費税 / 10% 原作者還元、
// OSS 非商用は経済圏外=全 0、そして料率定数の凍結スナップショット(design-k3 §2.7)。
import { describe, expect, it } from "vitest";
import { computeFees } from "../apps/api/src/market-settlement";
import {
  FEE_COMMERCIAL_RATE,
  FEE_MAINTENANCE_TAX_RATE,
  FEE_FORK_REVENUE_RATE,
} from "../apps/api/src/economy-constants";

describe("MKT-36 computeFees", () => {
  it("商用取引: 3% 文明拠出 + 8% 維持費税、fork_rebate は fork 由来のみ", () => {
    expect(computeFees(10000, { commercial: true, forked: false })).toEqual({
      civilization: 300,
      maintenance_tax: 800,
      fork_rebate: 0,
    });
    expect(computeFees(10000, { commercial: true, forked: true })).toEqual({
      civilization: 300,
      maintenance_tax: 800,
      fork_rebate: 1000,
    });
  });

  it("OSS 非商用は経済圏外: 全拠出 0", () => {
    expect(computeFees(10000, { commercial: false, forked: true })).toEqual({
      civilization: 0,
      maintenance_tax: 0,
      fork_rebate: 0,
    });
  });

  it("円未満は四捨五入", () => {
    // 333*.03=9.99→10 / 333*.08=26.64→27
    expect(computeFees(333, { commercial: true, forked: false })).toEqual({
      civilization: 10,
      maintenance_tax: 27,
      fork_rebate: 0,
    });
  });

  it("料率定数は凍結(スナップショット)", () => {
    expect({
      FEE_COMMERCIAL_RATE,
      FEE_MAINTENANCE_TAX_RATE,
      FEE_FORK_REVENUE_RATE,
    }).toEqual({
      FEE_COMMERCIAL_RATE: 0.03,
      FEE_MAINTENANCE_TAX_RATE: 0.08,
      FEE_FORK_REVENUE_RATE: 0.1,
    });
  });
});
