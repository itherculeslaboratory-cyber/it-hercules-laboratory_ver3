// V3-I18-09 / V3-I18-10 / V3-I18-11: 翻訳辞書の抽出・4層解決・LLM初期生成+fork/diff。
// reuse-first: LLM呼び出し自体は再発明しない — ai-kernel.ts の A90 "translate" タスク
// (LLMClient.complete)をそのまま DI で使う。IHL_AI_PROVIDER 未設定時は AiDisabledError
// で 501 に落ちる既存の既定 OFF 挙動をここでも踏襲する(不変条項①: LLM 既定 OFF)。
import { AiDisabledError, type LLMClient } from "./ai-kernel";

// ── V3-I18-09: 翻訳対象キー全般の抽出 ──────────────────────────────────────
// statement: "label/title/placeholderに加えaria-label/tooltip/option/message等" —
// OSレベルで抽出キー集合を1箇所に固定し、新画面追加時の翻訳漏れを防ぐ。
export const TRANSLATABLE_KEY_NAMES = [
  "label",
  "title",
  "placeholder",
  "aria-label",
  "tooltip",
  "option",
  "message",
] as const;
export type TranslatableKeyName = (typeof TRANSLATABLE_KEY_NAMES)[number];

export interface ExtractedTranslationKey {
  path: string; // UI JSON ツリー内のドットパス(重複検出・出典追跡用)
  key_name: TranslatableKeyName;
  source_text: string;
}

/**
 * 任意の UI JSON ツリーを走査し、TRANSLATABLE_KEY_NAMES に該当する文字列値を
 * 全て抽出する。新画面の JSON もこの関数を通せば自動的に対象キー集合へ入る
 * (statement「新画面追加時も翻訳漏れが出ないよう...保証する」)。
 */
export function extractTranslationKeys(uiJson: unknown, pathPrefix = ""): ExtractedTranslationKey[] {
  const out: ExtractedTranslationKey[] = [];
  walkForKeys(uiJson, pathPrefix, out);
  return out;
}

function walkForKeys(node: unknown, path: string, out: ExtractedTranslationKey[]): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => walkForKeys(item, `${path}[${i}]`, out));
    return;
  }
  if (typeof node !== "object" || node === null) return;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const childPath = path ? `${path}.${k}` : k;
    if ((TRANSLATABLE_KEY_NAMES as readonly string[]).includes(k) && typeof v === "string" && v.length > 0) {
      out.push({ path: childPath, key_name: k as TranslatableKeyName, source_text: v });
    }
    walkForKeys(v, childPath, out);
  }
}

// ── V3-I18-10: 4層辞書解決(user > country > official > auto) ────────────
export type TranslationLayer = "user" | "country" | "official" | "auto";
// statement: 「翻訳解決順を user > country > official > auto とし...優先順位は
// ユーザーが設定可能とする」— 既定順を固定値としてエクスポートし、呼び出し側が
// resolveTranslation の priority 引数で上書きできる形にする。
export const DEFAULT_TRANSLATION_LAYER_PRIORITY: readonly TranslationLayer[] = [
  "user",
  "country",
  "official",
  "auto",
];

export interface TranslationDictionaryEntry {
  key: string; // extractTranslationKeys().path と対応
  lang: string;
  layer: TranslationLayer;
  text: string;
}

/** key+lang に対し、優先順位(既定 user>country>official>auto)に沿って最初に見つかった訳文を返す。 */
export function resolveTranslation(
  entries: readonly TranslationDictionaryEntry[],
  key: string,
  lang: string,
  priority: readonly TranslationLayer[] = DEFAULT_TRANSLATION_LAYER_PRIORITY,
): string | undefined {
  for (const layer of priority) {
    const found = entries.find((e) => e.key === key && e.lang === lang && e.layer === layer);
    if (found) return found.text;
  }
  return undefined;
}

// ── V3-I18-11: LLM初期自動生成(英語ハブ→他言語)+ fork/diff 修正文化 ──────
export interface TranslationGenerationRequest {
  key: string;
  hub_text: string; // 英語(ハブ言語)
  target_lang: string;
}

export type TranslationGenerationResult =
  | { status: "generated"; entry: TranslationDictionaryEntry }
  | { status: "disabled" }; // AI_DISABLED(既定 OFF・不変条項①)と同じ意味の状態

/**
 * ai-kernel.ts の LLMClient(task:"translate")を使って auto レイヤーの初期訳文を
 * 生成する。プロバイダ未接続(既定)なら AiDisabledError を捕捉して
 * status:"disabled" を返す(呼び出し側は 501 相当として扱えばよい — フォーク/diff
 * で人間が上書きできる auto レイヤーが空のまま残るだけで壊れない)。
 */
export async function generateInitialTranslation(
  client: LLMClient,
  req: TranslationGenerationRequest,
): Promise<TranslationGenerationResult> {
  try {
    const { text } = await client.complete({
      task: "translate",
      input: { hub_text: req.hub_text, target_lang: req.target_lang },
    });
    return {
      status: "generated",
      entry: { key: req.key, lang: req.target_lang, layer: "auto", text },
    };
  } catch (e) {
    if (e instanceof AiDisabledError) return { status: "disabled" };
    throw e;
  }
}

export interface TranslationForkDiff {
  key: string;
  lang: string;
  base_layer: TranslationLayer; // どのレイヤーからフォークしたか(通常 auto)
  corrected_text: string;
  author_id: string;
}

/**
 * 「変な翻訳はユーザーがfork/diffで修正・改善できる文化にする」— 修正提案を
 * layer:"user" の新規辞書エントリとして追加する(既存 base_layer のエントリは
 * 書き換えない=フォーク。4層解決では user が最優先なので即座に有効になる)。
 */
export function applyTranslationForkDiff(
  entries: readonly TranslationDictionaryEntry[],
  diff: TranslationForkDiff,
): TranslationDictionaryEntry[] {
  const forked: TranslationDictionaryEntry = { key: diff.key, lang: diff.lang, layer: "user", text: diff.corrected_text };
  // 同じ key+lang+layer:"user" の既存フォークは置き換える(diff の再提出=最新が勝つ)。
  const rest = entries.filter((e) => !(e.key === diff.key && e.lang === diff.lang && e.layer === "user"));
  return [...rest, forked];
}
