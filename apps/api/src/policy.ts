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
