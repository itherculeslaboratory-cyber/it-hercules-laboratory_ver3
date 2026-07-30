#!/usr/bin/env node
// GATE/TOOL: 進捗マージツール(V3計画書§8対策・批評反映=致命1)。Wave 1以降、艦は
// docs/planning/c8/progress.json を直接書かず、報告書に「追記すべきJSON行」を貼るだけに
// する(9隻並列の同一ファイルread-modify-writeでlost updateが起きるため)。HQが検収時に
// このツールで安全に適用する。
//
// 入力: ファイル引数 または 標準入力。形式は「JSONオブジェクト配列」または「1行1オブジェクト
// (JSON Lines)」のどちらでも受け付ける。既存158件と同形式(id/title/cluster/wave/tier/lane/
// scope/status/commits/tc/note)のオブジェクトを想定するが、フィールド構成の検証はしない
// (progress.json自体のスキーマ検証は別ゲート=validate-schemas.mjs等の責務)。
//
// 既存IDは上書きしない(エラーで停止)。--update 指定時のみ上書きを許可する。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const PROGRESS_PATH = "docs/planning/c8/progress.json";

/** @param {string} raw @returns {object[]} */
export function parseInput(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  // まず「1つのJSON配列」として試す。
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed === "object" && parsed !== null) return [parsed];
  } catch {
    // 配列としてパース失敗 → JSON Lines(1行1オブジェクト)として再試行。
  }
  return trimmed.split(/\r?\n/).filter((l) => l.trim()).map((line, i) => {
    try {
      return JSON.parse(line);
    } catch (e) {
      throw new Error(`invalid JSON at line ${i + 1}: ${e.message}\n  line content: ${line.slice(0, 200)}`);
    }
  });
}

/**
 * @param {object[]} existing progress.jsonの現在の配列
 * @param {object[]} incoming 追記したいオブジェクト配列
 * @param {{update?: boolean}} opts
 * @returns {{merged: object[], added: number, updated: number}}
 */
export function mergeProgress(existing, incoming, opts = {}) {
  const byId = new Map(existing.map((e) => [e.id, e]));
  let added = 0;
  let updated = 0;
  for (const entry of incoming) {
    if (!entry || typeof entry !== "object" || !entry.id) {
      throw new Error(`incoming entry missing "id" field: ${JSON.stringify(entry)}`);
    }
    if (byId.has(entry.id)) {
      if (!opts.update) {
        throw new Error(`duplicate id "${entry.id}" already exists in progress.json (再実行するには --update を指定)`);
      }
      updated++;
    } else {
      added++;
    }
    byId.set(entry.id, entry);
  }
  // 挿入順を安定させるため、既存順を保ちつつ新規IDだけ末尾に追加する。
  const merged = [];
  const seen = new Set();
  for (const e of existing) {
    const cur = byId.get(e.id);
    merged.push(cur);
    seen.add(e.id);
  }
  for (const entry of incoming) {
    if (!seen.has(entry.id)) {
      merged.push(byId.get(entry.id));
      seen.add(entry.id);
    }
  }
  return { merged, added, updated };
}

function readInput(fileArg) {
  if (fileArg) return readFileSync(fileArg, "utf8");
  return readFileSync(0, "utf8"); // stdin
}

function main() {
  const args = process.argv.slice(2);
  const update = args.includes("--update");
  const fileArg = args.find((a) => !a.startsWith("--"));

  if (!existsSync(PROGRESS_PATH)) {
    console.error(`progress-merge: ${PROGRESS_PATH} not found (cwdがリポジトリルートか確認せよ)`);
    process.exit(2);
  }

  let raw;
  try {
    raw = readInput(fileArg);
  } catch (e) {
    console.error(`progress-merge: 入力の読み込みに失敗: ${e.message}`);
    process.exit(2);
  }

  let incoming;
  try {
    incoming = parseInput(raw);
  } catch (e) {
    console.error(`progress-merge FAILED(不正JSON): ${e.message}`);
    process.exit(1);
  }

  if (incoming.length === 0) {
    console.log("progress-merge: 入力が空。何も追記しない(EXIT=0)");
    process.exit(0);
  }

  const existing = JSON.parse(readFileSync(PROGRESS_PATH, "utf8"));
  const before = existing.length;

  let result;
  try {
    result = mergeProgress(existing, incoming, { update });
  } catch (e) {
    console.error(`progress-merge FAILED(重複ID・不正入力): ${e.message}`);
    process.exit(1);
  }

  // 妥当性検証: 書き戻す前にJSON.stringify→JSON.parseで往復できることを確認する。
  const serialized = JSON.stringify(result.merged, null, 2) + "\n";
  JSON.parse(serialized); // 往復できなければここで例外 → 書き込み前に停止する。

  writeFileSync(PROGRESS_PATH, serialized, "utf8");
  const after = result.merged.length;
  console.log(
    `progress-merge OK: 追加=${result.added} 上書き=${result.updated} 件数 ${before} → ${after}(差分 +${after - before})`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
