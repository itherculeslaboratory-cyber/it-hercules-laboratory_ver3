import { describe, it, expect } from "vitest";
import { calibratedRealLengthMm, SCALE_PAPER_MARKER_MM } from "./mm-precision";

// V3-OBS-45/53: port of apps/api/src/observation-constants.ts calibratedRealLengthMm.
// Same test vectors as tests/observation-ext.test.ts describe("OBS-45/53 calibratedRealLengthMm")
// in apps/api, so both packages agree on the formula's behaviour.
describe("calibratedRealLengthMm (V3-OBS-45/53 port)", () => {
  it("converts pixel length to real mm using the marker's known physical size", () => {
    // marker measures 100px in the photo and is known to be 10mm physically ->
    // mmPerPixel = 0.1 -> a 250px subject is 25mm.
    expect(calibratedRealLengthMm(250, 100, 10)).toBeCloseTo(25, 6);
  });

  it("defaults markerRealMm to SCALE_PAPER_MARKER_MM (10mm)", () => {
    expect(calibratedRealLengthMm(50, 100)).toBeCloseTo(5, 6);
    expect(SCALE_PAPER_MARKER_MM).toBe(10);
  });

  it("returns null on a degenerate marker detection (<=0 or non-finite)", () => {
    expect(calibratedRealLengthMm(100, 0)).toBeNull();
    expect(calibratedRealLengthMm(100, -5)).toBeNull();
    expect(calibratedRealLengthMm(100, NaN)).toBeNull();
  });

  it("returns null on a non-finite pixelLength", () => {
    expect(calibratedRealLengthMm(NaN, 100)).toBeNull();
    expect(calibratedRealLengthMm(Infinity, 100)).toBeNull();
  });
});
