// V3-KRM-16 policy table + V3-MKT-39 tradePolicyResolver.
// resolvePolicyInt returns the policy_int of the LATEST-timestamp row per key.
// The CSV is append-only history: GUI edits append newer rows; the resolver
// reads the newest and never mutates the old rows.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePolicyCsv, resolvePolicyInt, type PolicyRow } from "../apps/api/src/policy";
import {
  CONTRIBUTION_TITLE_THRESHOLD,
  CONTRIBUTION_PER_PLATINUM,
  INDULGENCE_INITIAL_PRICE_PT,
  KARMA_BAN_THRESHOLD,
} from "../apps/api/src/economy-constants";

const OLD = "2026-01-01T00:00:00Z";
const NEW = "2026-07-11T00:00:00Z";

describe("resolvePolicyInt (V3-MKT-39: latest row wins)", () => {
  it("two rows same key, old + new -> newest policy_int", () => {
    const rows: PolicyRow[] = [
      { policy_key: "fee.maintenance_tax_bps", policy_int: 500, timestamp: OLD },
      { policy_key: "fee.maintenance_tax_bps", policy_int: 800, timestamp: NEW },
    ];
    expect(resolvePolicyInt("fee.maintenance_tax_bps", rows)).toBe(800);
  });

  it("array order does not matter — newest timestamp still wins", () => {
    const rows: PolicyRow[] = [
      { policy_key: "k", policy_int: 800, timestamp: NEW },
      { policy_key: "k", policy_int: 500, timestamp: OLD },
    ];
    expect(resolvePolicyInt("k", rows)).toBe(800);
  });

  it("filters by exact key (no cross-key bleed)", () => {
    const rows: PolicyRow[] = [
      { policy_key: "a", policy_int: 1, timestamp: NEW },
      { policy_key: "b", policy_int: 2, timestamp: NEW },
    ];
    expect(resolvePolicyInt("a", rows)).toBe(1);
    expect(resolvePolicyInt("b", rows)).toBe(2);
  });

  it("unknown key throws, or returns fallback when given", () => {
    expect(() => resolvePolicyInt("nope", [])).toThrow();
    expect(resolvePolicyInt("nope", [], 42)).toBe(42);
  });
});

describe("V3-KRM-16: append-only history is read, never mutated", () => {
  it("resolver reads latest without dropping or editing older rows", () => {
    const rows: PolicyRow[] = [
      { policy_key: "contribution.title_threshold", policy_int: 5000, timestamp: OLD },
      { policy_key: "contribution.title_threshold", policy_int: 10000, timestamp: NEW },
    ];
    const snapshot = JSON.stringify(rows);
    expect(resolvePolicyInt("contribution.title_threshold", rows)).toBe(10000);
    expect(JSON.stringify(rows)).toBe(snapshot); // no mutation
    expect(rows).toHaveLength(2); // old row retained = history preserved
  });
});

describe("config CSVs parse and carry the frozen constant defaults", () => {
  it("economy-policy.csv default rows mirror economy-constants (design-k3 §2.7 duplication)", () => {
    const rows = parsePolicyCsv(
      readFileSync(new URL("../config/economy-policy.csv", import.meta.url), "utf8"),
    );
    expect(resolvePolicyInt("contribution.title_threshold", rows)).toBe(CONTRIBUTION_TITLE_THRESHOLD);
    expect(resolvePolicyInt("contribution.per_platinum", rows)).toBe(CONTRIBUTION_PER_PLATINUM);
    expect(resolvePolicyInt("indulgence.initial_price_pt", rows)).toBe(INDULGENCE_INITIAL_PRICE_PT);
    expect(resolvePolicyInt("karma.ban_threshold", rows)).toBe(KARMA_BAN_THRESHOLD);
    expect(resolvePolicyInt("platinum_vote.official_threshold", rows)).toBe(100);
  });

  it("market-governance.csv (3-column header) parses and resolves fee bps", () => {
    const rows = parsePolicyCsv(
      readFileSync(new URL("../config/market-governance.csv", import.meta.url), "utf8"),
    );
    expect(resolvePolicyInt("fee.maintenance_tax_bps", rows)).toBe(800);
    expect(resolvePolicyInt("fee.commercial_bps", rows)).toBe(300);
    expect(resolvePolicyInt("fee.fork_revenue_bps", rows)).toBe(1000);
    expect(rows.every((r) => r.domain === undefined)).toBe(true); // no domain column
  });
});
