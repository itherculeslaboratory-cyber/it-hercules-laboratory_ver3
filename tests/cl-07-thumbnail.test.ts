// CL-07: thumbnail 契約(長辺512px + format=JPEG) — schemas/frozen/thumbnail.schema.json。
// format は 2026-07-11 第10回ユーザー裁定で const "jpeg" に確定（形式=JPEG /
// 経路=jSquash on Workers / EXIF transpose 採用）。ver2 実装は 'png' だったが ver3 は
// greenfield ゆえ JPEG へ移行 — png は invalid（negative TC）になる。
// 裁定: docs/planning/rulings/user-ruling-2026-07-11-round-10.md。
import { describe, expect, it } from "vitest";
import { validateFrozen } from "@ihl/truth";
import { loadFixture } from "./helpers";

// The fixture is the historical ver2 sample (format:"png"); JPEG is the confirmed
// ver3 value, so positive cases override format to "jpeg".
const ver2Sample = loadFixture("cl-shape-samples.json")["cl-07"] as Record<
  string,
  unknown
>;
const sample = { ...ver2Sample, format: "jpeg" };

describe("CL-07 thumbnail manifest", () => {
  it("accepts a JPEG manifest (第10回裁定の確定値)", () => {
    expect(validateFrozen("thumbnail", sample).valid).toBe(true);
  });

  it("honours the long-edge invariant: max(w,h) === 512", () => {
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

  it("rejects the legacy ver2 png format (const=jpeg 確定後は invalid)", () => {
    expect((ver2Sample.format as string)).toBe("png");
    expect(validateFrozen("thumbnail", ver2Sample).valid).toBe(false);
  });

  it.each(["png", "PNG", "JPEG", "jpg", "webp", "avif"])(
    "rejects a non-jpeg format value %s",
    (fmt) => {
      const bad = { ...sample, format: fmt };
      expect(validateFrozen("thumbnail", bad).valid).toBe(false);
    },
  );

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
