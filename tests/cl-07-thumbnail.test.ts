// CL-07: thumbnail 契約(長辺512px) — schemas/frozen/thumbnail.schema.json。
// format は ver2 実装が 'png'・要件文が JPEG で矛盾しているため const なし
// (スキーマ description どおり、確定は C1 実機照合マター)。
import { describe, expect, it } from "vitest";
import { validateFrozen } from "@ihl/truth";
import { loadFixture } from "./helpers";

const sample = loadFixture("cl-shape-samples.json")["cl-07"] as Record<
  string,
  unknown
>;

describe("CL-07 thumbnail manifest", () => {
  it("accepts the real ver2 sample", () => {
    expect(validateFrozen("thumbnail", sample).valid).toBe(true);
  });

  it("ver2 sample honours the long-edge invariant: max(w,h) === 512", () => {
    const w = sample.width_px as number;
    const h = sample.height_px as number;
    expect(Math.max(w, h)).toBe(512);
  });

  it("rejects a long side over 512px", () => {
    const bad = { ...sample, width_px: 600 };
    expect(validateFrozen("thumbnail", bad).valid).toBe(false);
  });

  it("rejects a zero-size side", () => {
    const bad = { ...sample, height_px: 0 };
    expect(validateFrozen("thumbnail", bad).valid).toBe(false);
  });

  it("rejects a non-string format", () => {
    const bad = { ...sample, format: 42 };
    expect(validateFrozen("thumbnail", bad).valid).toBe(false);
  });

  it.each(["thumbnail_id", "thumbnail_path", "format", "run_id"])(
    "rejects a manifest missing required %s",
    (field) => {
      const bad = { ...sample };
      delete bad[field];
      expect(validateFrozen("thumbnail", bad).valid).toBe(false);
    },
  );
});
