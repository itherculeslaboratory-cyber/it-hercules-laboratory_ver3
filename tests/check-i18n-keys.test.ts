// V3-I18-08 — i18n key integrity. checkI18nKeys flags references to catalog keys
// that don't exist and raw-CJK display copy left un-keyed; every cluster-owned
// real screen-def resolves against i18n/ja.json.
import { describe, expect, it } from "vitest";
import { checkI18nKeys, runGate } from "../scripts/check-i18n-keys.mjs";
import { fileURLToPath } from "node:url";

// vitest cwd = tests/; the gate reads i18n/ + screen-defs/ from the repo root.
const ROOT = fileURLToPath(new URL("..", import.meta.url));

type Node = { id: string; type: string; props?: Record<string, unknown> };
const def = (nodes: Node[]) => ({ screen_id: "t", route: "/t", title: "t", nodes });

describe("V3-I18-08 checkI18nKeys", () => {
  it("flags a text_key/label_key absent from the catalog", () => {
    const d = def([
      { id: "h", type: "heading", props: { text_key: "t.head.title", text: "見出し" } },
      { id: "b", type: "button", props: { label_key: "t.save.label", label: "保存" } },
    ]);
    const v = checkI18nKeys(d, { "t.head.title": "OK" }); // save.label missing
    expect(v.some((m) => m.includes("t.save.label"))).toBe(true);
    expect(v.some((m) => m.includes("t.head.title"))).toBe(false);
  });

  it("flags raw CJK display copy that carries no key", () => {
    const d = def([{ id: "t", type: "text", props: { text: "鍵のない日本語" } }]);
    expect(checkI18nKeys(d, {}).some((m) => m.includes("raw CJK text"))).toBe(true);
    const dl = def([{ id: "b", type: "button", props: { label: "鍵なしラベル" } }]);
    expect(checkI18nKeys(dl, {}).some((m) => m.includes("raw CJK label"))).toBe(true);
  });

  it("accepts keyed CJK copy whose keys exist in the catalog", () => {
    const d = def([
      { id: "t", type: "text", props: { text_key: "t.x", text: "日本語" } },
      { id: "b", type: "button", props: { label_key: "t.y", label: "ラベル" } },
    ]);
    expect(checkI18nKeys(d, { "t.x": "日本語", "t.y": "ラベル" })).toEqual([]);
  });

  it("does not scan option labels / placeholders (data, not the i18n surface)", () => {
    const d = def([
      {
        id: "f",
        type: "field",
        props: {
          label_key: "t.locale",
          label: "言語",
          placeholder: "言語を選ぶ",
          options: [{ value: "ja", label: "日本語" }],
        },
      },
    ]);
    expect(checkI18nKeys(d, { "t.locale": "言語" })).toEqual([]);
  });

  it("every cluster-owned real screen-def resolves against i18n/ja.json", () => {
    expect(runGate(ROOT)).toEqual([]);
  });
});
