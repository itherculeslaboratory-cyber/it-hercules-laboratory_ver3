// V3-UIX-16 — theme-token codegen. config/design-tokens.json is the colour SSOT;
// codegen-theme-css.mjs emits apps/web/src/app/tokens.generated.css and the two
// built-in ThemePack JSON files. This GATE proves: (1) the codegen is idempotent
// and the committed outputs are in sync (so any hand-edit is caught by --check),
// (2) the generated CSS carries the 4 themed blocks, (3) drift is detectable.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  emitAll,
  diffAgainst,
  buildCss,
  loadTokens,
  COLOR_KEYS,
  BUILTIN_PACK_IDS,
} from "../scripts/codegen-theme-css.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

describe("V3-UIX-16 theme-token codegen", () => {
  it("committed outputs are byte-identical to the codegen (idempotent, in sync)", () => {
    const committed = new Map<string, string>();
    for (const rel of emitAll(ROOT).keys()) committed.set(rel, read(rel));
    expect(diffAgainst(committed, ROOT)).toEqual([]);
  });

  it("codegen is deterministic (two runs produce identical output)", () => {
    const a = [...emitAll(ROOT).entries()];
    const b = [...emitAll(ROOT).entries()];
    expect(a).toEqual(b);
  });

  it("generated CSS contains the 4 themed blocks (root light / media dark / data-theme light+dark)", () => {
    const css = buildCss(loadTokens(ROOT));
    expect(css).toMatch(/^:root \{/m);
    expect(css).toContain("@media (prefers-color-scheme: dark) {");
    expect(css).toContain(':root[data-theme="light"] {');
    expect(css).toContain(':root[data-theme="dark"] {');
    // every one of the (now 15) colour tokens is emitted
    for (const k of COLOR_KEYS) expect(css).toContain(`--civ-${k}:`);
  });

  // V3-UIX-04(色は意味のみ): caution(黄=注意)は以前 danger(赤=失敗)と同色で、badge の
  // "attention" 表示が「失敗」と見分けがつかなかった。両パックとも caution が danger と
  // 別値であることを固定し、この退行を再発防止する。
  it("caution/info トークンは danger/primary と別色(意味の混同を防ぐ・V3-UIX-04)", () => {
    const doc = loadTokens(ROOT);
    for (const id of BUILTIN_PACK_IDS) {
      const t = doc.packs[id].tokens;
      expect(t.caution.toLowerCase()).not.toBe(t.danger.toLowerCase());
      expect(t.info.toLowerCase()).not.toBe(t.primary.toLowerCase());
      expect(t.info.toLowerCase()).not.toBe(t.danger.toLowerCase());
    }
  });

  it("detects a hand-edit to a generated file (逆流禁止)", () => {
    const tampered = new Map<string, string>();
    for (const [rel, content] of emitAll(ROOT)) tampered.set(rel, content);
    const css = "apps/web/src/app/tokens.generated.css";
    tampered.set(css, tampered.get(css)!.replace("#fbfbf9", "#000000"));
    expect(diffAgainst(tampered, ROOT)).toContain(`stale: ${css}`);
  });

  it("each built-in pack JSON carries a GENERATED header and the 15 colour tokens", () => {
    for (const id of BUILTIN_PACK_IDS) {
      const raw = read(`theme-packs/${id}.json`);
      expect(raw).toContain("GENERATED");
      const pack = JSON.parse(raw);
      expect(pack.pack_id).toBe(id);
      expect(Object.keys(pack.tokens).sort()).toEqual([...COLOR_KEYS].sort());
    }
  });
});
