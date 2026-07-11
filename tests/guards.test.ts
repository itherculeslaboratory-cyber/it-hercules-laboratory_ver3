// V3-AIP-05 / 32 / 36 / 68 — machine-guard GATE unit tests. Each guard exports a
// pure decision function that is driven here with synthetic / adversarial input,
// so no real rtm.json, git history, or PR is required.
import { describe, expect, it } from "vitest";
import { checkRtm, RTM_GATES } from "../scripts/check-rtm.mjs";
import { checkReqFreeze } from "../scripts/check-req-freeze.mjs";
import {
  parseCommitMsg,
  filterCommitsInScope,
  INTENT_META_KEYS,
} from "../scripts/check-commit-msg.mjs";
import { classifyDangerousDiff } from "../scripts/check-danger-code.mjs";

// A requirement entry that closes on all five gates.
function closedEntry(id: string) {
  const e: Record<string, string> = { id };
  for (const g of RTM_GATES) e[g] = `ref/${g}`;
  return e;
}

describe("V3-AIP-05 checkRtm(5-gate closure)", () => {
  it("passes when every ID closes on all five gates", () => {
    const rtm = { mode: "enforce", requirements: [closedEntry("V3-AIP-05"), closedEntry("V3-AIP-32")] };
    expect(checkRtm(rtm)).toEqual([]);
  });

  it("fails an ID whose TEST-layer reference is empty (免除不可)", () => {
    const e = closedEntry("V3-AIP-05");
    e.test = ""; // empty TEST reference
    const v = checkRtm({ mode: "warn", requirements: [e] });
    expect(v).toContain("V3-AIP-05: gate 'test' has no reference");
  });

  it("fails an ID with an empty test array", () => {
    const rtm = { requirements: [{ ...closedEntry("V3-AIP-40"), test: [] }] };
    expect(checkRtm(rtm)).toContain("V3-AIP-40: gate 'test' has no reference");
  });
});

describe("V3-AIP-32 checkReqFreeze(requirement freeze)", () => {
  it("fails when 01-requirements/ changes without a ruling", () => {
    const v = checkReqFreeze(["01-requirements/srs.md", "apps/api/src/index.ts"]);
    expect(v.length).toBe(1);
  });

  it("passes when a ruling accompanies the requirement change", () => {
    const v = checkReqFreeze([
      "01-requirements/srs.md",
      "docs/planning/rulings/round-13.md",
    ]);
    expect(v).toEqual([]);
  });

  it("passes when no requirement file changed", () => {
    expect(checkReqFreeze(["apps/api/src/index.ts", "README.md"])).toEqual([]);
  });
});

describe("V3-AIP-36 parseCommitMsg(commit discipline)", () => {
  const goodBody = INTENT_META_KEYS.map((k) => `${k}: value`).join("\n");
  const goodMsg = `[01H0POST] reason text → change text → impact text\n\n${goodBody}`;

  it("passes a well-formed commit with post_id and full trailer", () => {
    const r = parseCommitMsg(goodMsg);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it("fails a subject missing the [post_id] prefix", () => {
    const r = parseCommitMsg(`reason → change → impact\n\n${goodBody}`);
    expect(r.ok).toBe(false);
  });

  it("fails a subject missing the three-arrow structure", () => {
    const r = parseCommitMsg(`[01H0POST] just a flat subject\n\n${goodBody}`);
    expect(r.ok).toBe(false);
  });

  it("fails when an intent-meta trailer key is missing", () => {
    const partial = INTENT_META_KEYS.slice(1).map((k) => `${k}: value`).join("\n");
    const r = parseCommitMsg(`[01H0POST] a → b → c\n\n${partial}`);
    expect(r.ok).toBe(false);
    expect(r.violations.some((m) => m.includes(INTENT_META_KEYS[0]))).toBe(true);
  });

  it("warns but does not fail on a null post_id (K6 未達)", () => {
    const r = parseCommitMsg(`[null] a → b → c\n\n${goodBody}`);
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBe(1);
  });

  it("exempts commits before BASELINE_REF from scope", () => {
    const commits = [
      { sha: "old", message: "legacy bad message" },
      { sha: "base", message: goodMsg },
      { sha: "new", message: goodMsg },
    ];
    const scoped = filterCommitsInScope(commits, "base");
    expect(scoped.map((c) => c.sha)).toEqual(["base", "new"]);
    expect(scoped.every((c) => parseCommitMsg(c.message).ok)).toBe(true);
  });

  it("treats a null BASELINE_REF as gate-off (empty scope)", () => {
    expect(filterCommitsInScope([{ sha: "x", message: "bad" }], null)).toEqual([]);
  });
});

describe("V3-AIP-68 classifyDangerousDiff(staging physical gate)", () => {
  it("flags a money-moving API call", () => {
    const diff = "+  await executeTransfer({ amount: 3000, to: acct });";
    const f = classifyDangerousDiff(diff);
    expect(f.some((x) => x.category === "money-api")).toBe(true);
  });

  it("flags a DNS / domain operation", () => {
    const diff = "+  await cf.zones.dns_records.create(zoneId, record);";
    const f = classifyDangerousDiff(diff);
    expect(f.some((x) => x.category === "dns-domain")).toBe(true);
  });

  it("flags a self-permission change", () => {
    const diff = '+    "permissions.allow": ["Bash(*)"],';
    const f = classifyDangerousDiff(diff);
    expect(f.some((x) => x.category === "self-permission")).toBe(true);
  });

  it("ignores dangerous patterns on REMOVED lines", () => {
    const diff = "-  await executeTransfer({ amount: 3000 });";
    expect(classifyDangerousDiff(diff)).toEqual([]);
  });

  it("passes a harmless diff", () => {
    const diff = "+  const label = t('home.title');\n+  return <h1>{label}</h1>;";
    expect(classifyDangerousDiff(diff)).toEqual([]);
  });
});
