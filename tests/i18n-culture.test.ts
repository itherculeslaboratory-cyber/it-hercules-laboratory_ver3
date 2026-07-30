// V3-I18-05(制約) / V3-I18-17(思想) — 言語設定の独立性 + 文化タグ・国籍の内部限定使用。
import { describe, expect, it } from "vitest";
import {
  validateLanguageSettingIndependence,
  LANGUAGE_SETTING_FORBIDDEN_FIELDS,
  toPublicProfileView,
  NATIONALITY_INTERNAL_USE_CASES,
  type InternalProfile,
} from "../apps/api/src/i18n-culture";

describe("V3-I18-05 validateLanguageSettingIndependence", () => {
  it("a clean language setting ({lang}) passes with no violations", () => {
    expect(validateLanguageSettingIndependence({ lang: "ja" })).toEqual([]);
  });

  it("flags nationality/residence/timezone/jurisdiction/kyc if mixed into a language setting", () => {
    const violations = validateLanguageSettingIndependence({
      lang: "ja",
      nationality: "JP",
      timezone: "Asia/Tokyo",
      kyc_status: "verified",
    });
    expect(violations.sort()).toEqual(["kyc_status", "nationality", "timezone"].sort());
  });

  it("LANGUAGE_SETTING_FORBIDDEN_FIELDS covers all 5 named-independent axes (国籍/居住地/タイムゾーン/法的管轄/KYC)", () => {
    expect(LANGUAGE_SETTING_FORBIDDEN_FIELDS).toContain("nationality");
    expect(LANGUAGE_SETTING_FORBIDDEN_FIELDS).toContain("residence");
    expect(LANGUAGE_SETTING_FORBIDDEN_FIELDS).toContain("timezone");
    expect(LANGUAGE_SETTING_FORBIDDEN_FIELDS).toContain("jurisdiction");
    expect(LANGUAGE_SETTING_FORBIDDEN_FIELDS).toContain("kyc");
  });
});

describe("V3-I18-17 toPublicProfileView (国旗デフォルト非表示・国籍は型として公開しない)", () => {
  const internal: InternalProfile = {
    actor_id: "u1",
    nationality: "JP",
    culture_tags: [{ id: "ct1", label: "夜行性愛好" }],
  };

  it("never includes nationality in the public view (型として存在しない)", () => {
    const pub = toPublicProfileView(internal);
    expect("nationality" in pub).toBe(false);
  });

  it("flag_visible defaults to false when show_flag is not set", () => {
    expect(toPublicProfileView(internal).flag_visible).toBe(false);
  });

  it("flag_visible becomes true only when show_flag is explicitly true (任意ON)", () => {
    expect(toPublicProfileView({ ...internal, show_flag: true }).flag_visible).toBe(true);
    expect(toPublicProfileView({ ...internal, show_flag: false }).flag_visible).toBe(false);
  });

  it("culture_tags pass through unchanged (国籍の代わりに行動傾向タグを使う)", () => {
    expect(toPublicProfileView(internal).culture_tags).toEqual(internal.culture_tags);
  });

  it("NATIONALITY_INTERNAL_USE_CASES is the closed list from the statement (7用途)", () => {
    expect(NATIONALITY_INTERNAL_USE_CASES).toHaveLength(7);
    expect(NATIONALITY_INTERNAL_USE_CASES).toContain("translation");
    expect(NATIONALITY_INTERNAL_USE_CASES).toContain("gov35_same_country_grouping");
  });
});
