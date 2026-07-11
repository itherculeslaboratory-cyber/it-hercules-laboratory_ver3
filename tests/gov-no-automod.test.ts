// GOV-13 negative 回帰。自動モデレーションは思想として不採用 — apps/api/src を走査し、
// auto-moderation endpoint(route 登録)も NG ワード表(禁止語配列の定数宣言)も存在しないことを
// assert する。実装物はゼロなので、実装が忍び込んだら赤くなる守り。it 名は ASCII。
// 構造パターン(route 登録・配列定数宣言)で照合し、コメント/散文には反応しない。
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("../apps/api/src/", import.meta.url));

function readAllSources(): { file: string; text: string }[] {
  return readdirSync(SRC_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => ({ file: f, text: readFileSync(SRC_DIR + f, "utf8") }));
}

describe("GOV-13 no auto-moderation (negative regression)", () => {
  const sources = readAllSources();

  it("registers no auto-moderation endpoint", () => {
    // Hono route registrations whose path names an auto-moderation surface.
    const routeRe = /\.(get|post|put|delete|patch)\(\s*["'`][^"'`]*(automod|auto-?moderation|moderat|ng-?word|banword|blockword)/i;
    const offenders = sources.filter((s) => routeRe.test(s.text)).map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it("declares no NG-word / banned-word list constant", () => {
    // A forbidden-word array constant declaration (NG ワード表).
    const listRe = /\b(NG_?WORDS|BANNED_?WORDS|BLOCKED_?WORDS|BLOCK_?LIST|BLACK_?LIST|FORBIDDEN_?WORDS|PROFANITY|BAD_?WORDS)\b\s*[:=]\s*\[/i;
    const offenders = sources.filter((s) => listRe.test(s.text)).map((s) => s.file);
    expect(offenders).toEqual([]);
  });
});
