// V3-OBS-15: 環境派生値(露点/VPD/絶対湿度)は生値(温度・湿度)からの再計算のみで、
// Truthには残さない。ここでは deriveEnvironmentValues() の純粋計算部分を検証する
// (PURE — no IO, no TruthStore). 既存の CSV 取込(V3-OBS-32/tests/env-import.test.ts)
// が dew_point/vpd/abs_humidity を SwitchBot エクスポート列としてそのまま保存する
// 現行動作とは別軸の検証であることに注意(既存golden fixtureの期待値は本テストでは
// 変更しない・越境しない)。
import { describe, expect, it } from "vitest";
import { deriveEnvironmentValues } from "../apps/api/src/observation-constants";

describe("V3-OBS-15 deriveEnvironmentValues (query-time recompute, never stored)", () => {
  it("25C/60%RH -> plausible dew point below the air temp and positive VPD/absolute humidity", () => {
    const r = deriveEnvironmentValues(25, 60);
    expect(r.dewPointC).not.toBeNull();
    expect(r.dewPointC as number).toBeLessThan(25);
    expect(r.dewPointC as number).toBeGreaterThan(10); // sanity band, not an exact literature value
    expect(r.vpdKPa as number).toBeGreaterThan(0);
    expect(r.absHumidityGm3 as number).toBeGreaterThan(0);
  });

  it("100%RH -> dew point equals air temp (saturated) and VPD ~ 0", () => {
    const r = deriveEnvironmentValues(20, 100);
    expect(r.dewPointC as number).toBeCloseTo(20, 0);
    expect(r.vpdKPa as number).toBeCloseTo(0, 5);
  });

  it("out-of-domain humidity (<=0 or >100) -> all null, never a fabricated number", () => {
    expect(deriveEnvironmentValues(20, 0)).toEqual({ dewPointC: null, vpdKPa: null, absHumidityGm3: null });
    expect(deriveEnvironmentValues(20, 101)).toEqual({ dewPointC: null, vpdKPa: null, absHumidityGm3: null });
    expect(deriveEnvironmentValues(NaN, 50)).toEqual({ dewPointC: null, vpdKPa: null, absHumidityGm3: null });
  });

  it("is a pure function: same inputs -> byte-identical outputs, no hidden state", () => {
    const a = deriveEnvironmentValues(18.5, 45);
    const b = deriveEnvironmentValues(18.5, 45);
    expect(a).toEqual(b);
  });
});
