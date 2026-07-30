// Config-driven integer policy resolver (V3-KRM-16 economy-policy /
// V3-MKT-39 tradePolicyResolver). The CSV config is an append-only history:
// GUI edits (後波) append a new row with a newer timestamp; the resolver reads
// the latest row per key and never mutates history. Pure functions only —
// callers pass rows they already parsed (workerd cannot readFileSync at
// runtime; bundle the CSV text via esbuild text import, then parsePolicyCsv it).
//
// ponytail: CSV, not a DB — policy tables are tiny and read at request time by
// full scan. Add an index only if a table grows past thousands of rows.

export type PolicyRow = {
  policy_key: string;
  policy_int: number;
  domain?: string;
  timestamp: string;
};

/**
 * Parse a policy CSV (header row names the columns; column order is not
 * assumed). Requires policy_key, policy_int, timestamp; domain is optional.
 * Blank lines are skipped. policy_int must be an integer.
 */
export function parsePolicyCsv(text: string): PolicyRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const kI = idx("policy_key");
  const vI = idx("policy_int");
  const tI = idx("timestamp");
  const dI = idx("domain");
  if (kI < 0 || vI < 0 || tI < 0) {
    throw new Error("policy CSV missing required column (policy_key/policy_int/timestamp)");
  }
  const rows: PolicyRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const policy_int = Number(cols[vI]);
    if (!Number.isInteger(policy_int)) {
      throw new Error(`policy CSV row ${i}: policy_int not an integer: ${cols[vI]}`);
    }
    rows.push({
      policy_key: cols[kI],
      policy_int,
      timestamp: cols[tI],
      ...(dI >= 0 && cols[dI] ? { domain: cols[dI] } : {}),
    });
  }
  return rows;
}

/**
 * Resolve the current integer value for policy_key: the policy_int of the row
 * with the latest timestamp (append-only history — older rows are retained but
 * superseded). Throws if the key is absent and no fallback is given.
 */
export function resolvePolicyInt(
  policyKey: string,
  rows: PolicyRow[],
  fallback?: number,
): number {
  let best: PolicyRow | undefined;
  for (const row of rows) {
    if (row.policy_key !== policyKey) continue;
    if (!best || Date.parse(row.timestamp) > Date.parse(best.timestamp)) best = row;
  }
  if (best) return best.policy_int;
  if (fallback !== undefined) return fallback;
  throw new Error(`policy key not found: ${policyKey}`);
}

// ── V3-SEC-15 open-redirect ガード ──────────────────────────────────────
// 認証済み /login?next= の遷移先は「内部絶対パス(/始まり・//不可)」のみ許可する。
// それ以外(外部URL・プロトコル相対 //evil.com・空値)は "/" にフォールバックする。
// 呼び出し側(auth-routes.ts の /login?next= 相当処理・w1-aut所有)は本関数の戻り値を
// そのまま redirect 先として使えばよい(判定ロジックをここに一本化・重複実装させない)。
export function safeNextPath(next: string | null | undefined): string {
  if (typeof next !== "string" || next.length === 0) return "/";
  if (!next.startsWith("/")) return "/"; // 外部URL(http://...)・相対パスを拒否
  if (next.startsWith("//")) return "/"; // プロトコル相対(スキームレス外部URL)を拒否
  return next;
}

// ── V3-SEC-19 本番認証バイパス変数の不在チェック ───────────────────────────
// 要件本文が名指しする IHL_AUTH_REQUIRED/IHL_AUTH_BYPASS/IHL_WEB_AUTH_BYPASS は、
// 現行の index.ts 認可ゲート(deny-by-default・PUBLIC_ROUTES 明示リスト方式)には
// 実装として存在しない(該当変数名の参照はコード中ゼロ件・2026-07-31実測)。この関数は
// 将来これらの変数名が実装に持ち込まれた場合に備えた回帰チェック(CI/ops が呼べる)。
export interface ProdAuthEnvCheck {
  ok: boolean;
  problems: string[];
}
export function checkProdAuthEnv(env: Record<string, string | undefined>): ProdAuthEnvCheck {
  const problems: string[] = [];
  if (env.IHL_AUTH_REQUIRED !== undefined && env.IHL_AUTH_REQUIRED !== "1") {
    problems.push("IHL_AUTH_REQUIRED must be '1' (or left unset in code that has no bypass path)");
  }
  if (env.IHL_AUTH_BYPASS) problems.push("IHL_AUTH_BYPASS must be unset in production");
  if (env.IHL_WEB_AUTH_BYPASS) problems.push("IHL_WEB_AUTH_BYPASS must be unset (would bypass all routes)");
  return { ok: problems.length === 0, problems };
}
