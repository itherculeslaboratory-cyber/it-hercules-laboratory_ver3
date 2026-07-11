import { describe, it, expect } from "vitest";
import {
  DEFAULT_LOCALE,
  fallbackLocales,
  lookupMessage,
  resolveMessage,
  makeResolver,
  loadCatalogs,
  type Catalogs,
} from "./i18n";

// V3-I18-08: the resolver walks exact -> lang -> ja -> key and NEVER returns "".
describe("i18n resolver — fallback chain (V3-I18-08)", () => {
  const catalogs: Catalogs = {
    "ja-JP": { "home.title.text": "観測ホーム(JP)" },
    ja: { "home.title.text": "観測ホーム", "home.lead.text": "ja だけの文言" },
    en: { "home.title.text": "Observation Home" },
  };

  it("resolves the exact locale first (ja-JP before ja)", () => {
    expect(resolveMessage(catalogs, "ja-JP", "home.title.text")).toBe("観測ホーム(JP)");
  });

  it("falls back to the language subtag when the exact locale lacks the key", () => {
    // ja-JP has no lead key -> language subtag ja supplies it.
    expect(resolveMessage(catalogs, "ja-JP", "home.lead.text")).toBe("ja だけの文言");
  });

  it("falls back to the DEFAULT (ja) layer for an unsupported locale", () => {
    // fr is authored nowhere; the always-filled ja layer answers (never blank).
    const msg = resolveMessage(catalogs, "fr", "home.title.text");
    expect(msg).toBe("観測ホーム");
    expect(msg).not.toBe("");
  });

  it("prefers the language catalog over ja when present (en overlay)", () => {
    expect(resolveMessage(catalogs, "en-US", "home.title.text")).toBe("Observation Home");
    // en has no lead key -> chain reaches ja.
    expect(resolveMessage(catalogs, "en-US", "home.lead.text")).toBe("ja だけの文言");
  });

  it("returns the key itself (never empty) as the last resort", () => {
    const key = "unknown.missing.text";
    expect(resolveMessage(catalogs, "en", key)).toBe(key);
    expect(resolveMessage(catalogs, "en", key)).not.toBe("");
  });

  it("treats an empty-string catalog value as a miss and keeps falling back", () => {
    const c: Catalogs = { en: { "x.y.z": "" }, ja: { "x.y.z": "ja 値" } };
    expect(resolveMessage(c, "en", "x.y.z")).toBe("ja 値");
  });
});

describe("fallbackLocales — ordering + dedup", () => {
  it("expands and de-duplicates the chain", () => {
    expect(fallbackLocales("ja-JP")).toEqual(["ja-JP", "ja"]);
    expect(fallbackLocales("en-US")).toEqual(["en-US", "en", "ja"]);
    expect(fallbackLocales("ja")).toEqual(["ja"]);
    expect(fallbackLocales("fr")).toEqual(["fr", "ja"]);
  });
  it("DEFAULT_LOCALE is ja (authored language)", () => {
    expect(DEFAULT_LOCALE).toBe("ja");
  });
});

describe("makeResolver — Renderer literal-fallback contract", () => {
  const catalogs: Catalogs = { ja: { "home.title.text": "観測ホーム" } };
  it("returns undefined for an unknown key so the Renderer uses the literal", () => {
    const resolve = makeResolver(catalogs, "ja");
    expect(resolve("home.title.text")).toBe("観測ホーム");
    expect(resolve("nope.no.key")).toBeUndefined();
  });
});

// Wire the resolver against the REAL repo catalogs — proves the ja seed is
// complete enough that an unsupported viewer locale still gets Japanese, and a
// known screen key never comes back blank (design-k4 §1.4 "描画結果バイト同一").
describe("i18n resolver — against the on-disk catalogs", () => {
  const catalogs = loadCatalogs();

  it("ships a ja catalog with the home title key", () => {
    expect(catalogs.ja?.["home.title.text"]).toBeTruthy();
  });

  it("an unsupported locale still resolves to the Japanese seed (non-empty)", () => {
    const msg = resolveMessage(catalogs, "fr-FR", "home.title.text");
    expect(msg).toBe(catalogs.ja["home.title.text"]);
    expect(msg.length).toBeGreaterThan(0);
  });

  it("every key present in the en overlay also exists in the ja seed", () => {
    for (const k of Object.keys(catalogs.en ?? {})) {
      expect(catalogs.ja?.[k], `ja seed missing overlay key ${k}`).toBeTruthy();
    }
  });
});
