// V3-I18-09 / V3-I18-10 / V3-I18-11 — 翻訳キー抽出・4層解決・LLM初期生成+fork/diff。
import { describe, expect, it } from "vitest";
import { AiDisabledError, type LLMClient } from "../apps/api/src/ai-kernel";
import {
  extractTranslationKeys,
  resolveTranslation,
  generateInitialTranslation,
  applyTranslationForkDiff,
  DEFAULT_TRANSLATION_LAYER_PRIORITY,
  type TranslationDictionaryEntry,
} from "../apps/api/src/i18n-dictionary";

describe("V3-I18-09 extractTranslationKeys", () => {
  it("extracts label/title/placeholder/aria-label/tooltip/option/message from a nested UI JSON tree", () => {
    const ui = {
      screen: {
        title: "Observation",
        fields: [
          { label: "Species", placeholder: "Enter species" },
          { "aria-label": "Submit", tooltip: "Click to submit" },
        ],
        options: [{ option: "Yes" }, { option: "No" }],
        message: "Saved",
      },
    };
    const keys = extractTranslationKeys(ui);
    const texts = keys.map((k) => k.source_text).sort();
    expect(texts).toEqual(
      ["Click to submit", "Enter species", "No", "Observation", "Saved", "Species", "Submit", "Yes"].sort(),
    );
  });

  it("ignores non-translatable keys and empty strings", () => {
    const ui = { id: "x1", label: "", count: 3 };
    expect(extractTranslationKeys(ui)).toEqual([]);
  });

  it("returns [] for a UI tree with no translatable keys (no translation漏れ源が無いことも正しく扱う)", () => {
    expect(extractTranslationKeys({ a: { b: { c: 1 } } })).toEqual([]);
  });
});

describe("V3-I18-10 resolveTranslation (user > country > official > auto)", () => {
  const entries: TranslationDictionaryEntry[] = [
    { key: "k1", lang: "ja", layer: "auto", text: "自動訳" },
    { key: "k1", lang: "ja", layer: "official", text: "公式訳" },
    { key: "k1", lang: "ja", layer: "user", text: "ユーザー訳" },
  ];

  it("prefers user over country/official/auto by default", () => {
    expect(resolveTranslation(entries, "k1", "ja")).toBe("ユーザー訳");
  });

  it("falls back to official when user/country are absent", () => {
    const withoutUser = entries.filter((e) => e.layer !== "user");
    expect(resolveTranslation(withoutUser, "k1", "ja")).toBe("公式訳");
  });

  it("falls back to auto when only auto exists", () => {
    const onlyAuto = entries.filter((e) => e.layer === "auto");
    expect(resolveTranslation(onlyAuto, "k1", "ja")).toBe("自動訳");
  });

  it("returns undefined when no entry matches key+lang", () => {
    expect(resolveTranslation(entries, "unknown-key", "ja")).toBeUndefined();
  });

  it("priority order is user-overridable (statement: 優先順位はユーザーが設定可能)", () => {
    const reversed = [...DEFAULT_TRANSLATION_LAYER_PRIORITY].reverse();
    expect(resolveTranslation(entries, "k1", "ja", reversed)).toBe("自動訳");
  });
});

describe("V3-I18-11 generateInitialTranslation (reuse: ai-kernel LLMClient DI)", () => {
  it("degrades to status:disabled when the LLM client is AI_DISABLED (既定OFF)", async () => {
    const disabledClient: LLMClient = { complete: async () => { throw new AiDisabledError(); } };
    const result = await generateInitialTranslation(disabledClient, { key: "k1", hub_text: "Hello", target_lang: "ja" });
    expect(result.status).toBe("disabled");
  });

  it("returns an auto-layer entry when the client produces a translation", async () => {
    const fakeClient: LLMClient = { complete: async () => ({ text: "こんにちは" }) };
    const result = await generateInitialTranslation(fakeClient, { key: "k1", hub_text: "Hello", target_lang: "ja" });
    expect(result.status).toBe("generated");
    if (result.status === "generated") {
      expect(result.entry).toEqual({ key: "k1", lang: "ja", layer: "auto", text: "こんにちは" });
    }
  });
});

describe("V3-I18-11 applyTranslationForkDiff (fork/diff 修正文化)", () => {
  it("adds a user-layer correction that resolveTranslation then prefers", () => {
    const base: TranslationDictionaryEntry[] = [{ key: "k1", lang: "ja", layer: "auto", text: "変な訳" }];
    const forked = applyTranslationForkDiff(base, {
      key: "k1",
      lang: "ja",
      base_layer: "auto",
      corrected_text: "正しい訳",
      author_id: "u1",
    });
    expect(resolveTranslation(forked, "k1", "ja")).toBe("正しい訳");
    // 元の auto エントリは書き換えられていない(フォーク=追加、上書きではない)
    expect(forked.find((e) => e.layer === "auto")?.text).toBe("変な訳");
  });

  it("resubmitting a diff for the same key+lang replaces the prior user fork (最新が勝つ)", () => {
    const base: TranslationDictionaryEntry[] = [{ key: "k1", lang: "ja", layer: "auto", text: "変な訳" }];
    const first = applyTranslationForkDiff(base, { key: "k1", lang: "ja", base_layer: "auto", corrected_text: "v1", author_id: "u1" });
    const second = applyTranslationForkDiff(first, { key: "k1", lang: "ja", base_layer: "auto", corrected_text: "v2", author_id: "u1" });
    expect(second.filter((e) => e.layer === "user")).toHaveLength(1);
    expect(resolveTranslation(second, "k1", "ja")).toBe("v2");
  });
});
