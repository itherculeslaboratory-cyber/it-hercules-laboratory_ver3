// V3-FND-20(持ち越し・61代目HQ裁定(c)採用): 02-design/adr/adr-v3-wasm-01-script-driver.md
// が固定した「AST 最小仕様(固定する契約)」節の ScriptManifest/ScriptError/
// ScriptAuditLogEntry 型と、危険API拒否ゲートの MVP 実装。
//
// 誇張ゼロの明記: ADR 自身が「WASM ランタイム(Extism/Spin)自体・AST バリデータ
// (パーサ+ホワイトリスト規則エンジン)は 1 セッションの残枠に収まらない」と明記した
// 規模判断は本ランでも変わらない — Extism/Spin の埋め込みは行わない(依存追加ゼロ・
// V3-FND-28 凍結遵守)。ここで実装するのは ADR の「次のセッションが着手する際の入口」
// (3)に相当する契約の型と、AST 静的検証の**代替として使える正規表現ベースの MVP
// 静的スキャナ**のみ。真の AST パーサではない — allowed_apis に無い呼び出しの
// "検出漏れ"を防ぐことは保証しない(識別子の出現をテキストスキャンするだけ)。この
// 限界を validateManifest() のドキュメントコメントにも明記する。真の AST 検証器は
// この関数を置き換える形の次波フォローアップ。
export interface ScriptManifest {
  id: string;
  version: string;
  language: "js-subset"; // ADR: 初回は1言語のみ(全言語相互変換は目標から外す)
  allowed_apis: string[]; // ホワイトリスト(既定は空 = 何も呼べない)
  entrypoint: string;
}

export interface ScriptError {
  code: string;
  message: string;
}

export interface ScriptAuditLogEntry {
  run_id: string;
  script_id: string;
  script_version: string;
  started_at: string;
  allowed_apis_used: string[];
  status: "ok" | "denied" | "error";
}

// ADR: 「危険API(ファイル書込/ネットワーク/OSコマンド)はASTレベルで書けないように
// する」の対象識別子。node/deno のグローバル・モジュール名の代表的な部分集合
// (網羅を主張しない=誇張ゼロ)。
export const DANGEROUS_API_IDENTIFIERS: readonly string[] = [
  "require",
  "import(",
  "fetch",
  "XMLHttpRequest",
  "fs",
  "child_process",
  "process",
  "eval",
  "Function", // `new Function` 経由のコード注入(このリポジトリ自体が envelope.ts で
  // ajv standalone を選んだ理由と同じ懸念 — workerd も new Function を禁じる)
];

/** manifest の形式チェック(ADR契約に沿った最小フィールド検証)。 */
export function validateManifestShape(manifest: unknown): { valid: boolean; errors: ScriptError[] } {
  const errors: ScriptError[] = [];
  if (typeof manifest !== "object" || manifest === null) {
    return { valid: false, errors: [{ code: "MANIFEST_NOT_OBJECT", message: "manifest must be an object" }] };
  }
  const m = manifest as Record<string, unknown>;
  if (typeof m.id !== "string" || m.id.length === 0) errors.push({ code: "MANIFEST_MISSING_ID", message: "id is required" });
  if (typeof m.version !== "string" || m.version.length === 0) errors.push({ code: "MANIFEST_MISSING_VERSION", message: "version is required" });
  if (m.language !== "js-subset") errors.push({ code: "MANIFEST_UNSUPPORTED_LANGUAGE", message: "only language:'js-subset' is supported (all-language interop is explicitly out of scope per ADR-V3-WASM-01)" });
  if (!Array.isArray(m.allowed_apis)) errors.push({ code: "MANIFEST_MISSING_ALLOWED_APIS", message: "allowed_apis must be an array (empty = nothing callable)" });
  if (typeof m.entrypoint !== "string" || m.entrypoint.length === 0) errors.push({ code: "MANIFEST_MISSING_ENTRYPOINT", message: "entrypoint is required" });
  return { valid: errors.length === 0, errors };
}

/**
 * 危険API拒否の MVP 静的スキャン(実行前ゲート・ADR「実行前ゲートを一次防御とする」
 * に対応)。allowed_apis に無い危険識別子がソース中に出現したら拒否する。
 *
 * 限界(誇張ゼロ): これは正規表現ベースのテキストスキャンであり、真の AST 解析では
 * ない。文字列リテラル中の偶然の一致で誤検知しうる一方、難読化(例: `req` + `uire`
 * の動的結合)は検出できない — ADR が「AST バリデータは言語ごとに別実装が要る」と
 * 明記した本格実装への置き換えを前提とした暫定ゲート。
 */
export function scanForDeniedApis(source: string, allowedApis: readonly string[]): ScriptError[] {
  const denied: ScriptError[] = [];
  for (const api of DANGEROUS_API_IDENTIFIERS) {
    if (allowedApis.includes(api)) continue; // ホワイトリストに明示されていれば許可
    const escaped = api.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\b${escaped}`);
    if (pattern.test(source)) {
      denied.push({ code: "SCRIPT_DENIED_API", message: `denied API reference found: ${api}` });
    }
  }
  return denied;
}

/**
 * manifest + ソースの両方を検証する。形式が不正、または危険APIが検出された場合は
 * status:"denied" の ScriptAuditLogEntry を返す(実行はしない — 呼び出し側が実行前
 * ゲートとして使う)。run_id は呼び出し側の ulid() 等を渡す(このモジュールは Truth
 * 依存を持たない=純粋関数のまま)。
 */
export function auditScript(
  runId: string,
  manifest: ScriptManifest,
  source: string,
  now: Date,
): { entry: ScriptAuditLogEntry; errors: ScriptError[] } {
  const shape = validateManifestShape(manifest);
  const deniedApis = shape.valid ? scanForDeniedApis(source, manifest.allowed_apis) : [];
  const errors = [...shape.errors, ...deniedApis];
  const status: ScriptAuditLogEntry["status"] = errors.length > 0 ? "denied" : "ok";
  return {
    entry: {
      run_id: runId,
      script_id: shape.valid ? manifest.id : "(invalid-manifest)",
      script_version: shape.valid ? manifest.version : "(invalid-manifest)",
      started_at: now.toISOString(),
      allowed_apis_used: [],
      status,
    },
    errors,
  };
}
