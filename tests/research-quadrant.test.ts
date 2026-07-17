// V3-PPR-07 — 観測データの4象限モデル(P∧Q=n11/P∧¬Q=n10/¬P∧Q=n01/¬P∧¬Q=n00)で
// 研究の空白領域を検出する。P/Q 判定は matchConditions/autoFillDescriptor と同一実装を
// 再利用(車輪の再発明をしない)。決定論・LLM 不使用(不変条項①)。
import { describe, expect, it } from "vitest";
import { quadrantAnalysis, derivePropositions, hypothesisDraftsForGaps } from "../apps/api/src/paper-match";
import app from "../apps/api/src/index";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

// P-defining key = temp (not in evidence_keys) / Q-defining key = growth (claim.evidence_keys).
// Both must be `required:true` in conditions for matchConditions to evaluate them
// (quadrantAnalysis partitions required condition keys into P-keys vs evidence(Q)-keys).
const conditions = {
  temp: { min: 25, max: 30, required: true },
  growth: { min: 1, required: true },
};
const claim = { claim_id: "c1", statement: "high growth rate", evidence_keys: ["growth"] };

describe("quadrantAnalysis", () => {
  it("classifies observations into n11/n10/n01/n00 and flags thin quadrants as gaps", () => {
    const observations = [
      { temp: 27, growth: 1 }, // P∧Q -> n11
      { temp: 27, growth: 1 }, // n11
      { temp: 27 }, // P∧¬Q -> n10 (growth missing -> claim not evidenced)
      { temp: 99, growth: 1 }, // ¬P∧Q -> n01 (temp out of range)
      // no n00 example at all -> density 0 -> definitely a gap
    ];
    const r = quadrantAnalysis(conditions, claim, observations, 0.3);
    expect(r).toMatchObject({ n11: 2, n10: 1, n01: 1, n00: 0, total: 4 });
    expect(r.density.n00).toBe(0);
    expect(r.gaps).toContain("n00"); // 0% density < 30% threshold
    expect(r.gaps).not.toContain("n11"); // 2/4=50% >= 30% threshold
  });

  it("no P-defining keys (all required keys are evidence keys) treats P as always true", () => {
    // conditions has only the Q(evidence) key -> pKeys=[] -> P always true regardless of obs.
    const growthOnly = { growth: { min: 1, required: true } };
    const r = quadrantAnalysis(growthOnly, claim, [{ growth: 1 }, {}], 0.5);
    expect(r.n11).toBe(1); // P true, Q true
    expect(r.n10).toBe(1); // P true, Q false (growth missing)
    expect(r.n01).toBe(0);
    expect(r.n00).toBe(0);
  });

  it("empty observations -> all counts zero, density zero, every quadrant a gap", () => {
    const r = quadrantAnalysis(conditions, claim, [], 0.05);
    expect(r.total).toBe(0);
    expect(r.gaps.sort()).toEqual(["n00", "n01", "n10", "n11"]);
  });
});

describe("derivePropositions", () => {
  it("generates converse / inverse / contrapositive from P and Q labels", () => {
    const d = derivePropositions("温度25-30度", "高成長率");
    expect(d.converse).toBe("高成長率 ⇒ 温度25-30度");
    expect(d.inverse).toBe("¬(温度25-30度) ⇒ ¬(高成長率)");
    expect(d.contrapositive).toBe("¬(高成長率) ⇒ ¬(温度25-30度)");
  });
});

describe("hypothesisDraftsForGaps", () => {
  it("generates one title+abstract per gap quadrant, deterministically", () => {
    const drafts = hypothesisDraftsForGaps(["n00", "n11"], "P", "Q");
    expect(drafts.map((d) => d.quadrant)).toEqual(["n00", "n11"]);
    for (const d of drafts) {
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.abstract.length).toBeGreaterThan(0);
    }
  });
});

describe("POST /api/v1/research/quadrant", () => {
  it("returns quadrant density + gaps + derived propositions + hypothesis drafts", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const res = await app.request(
      "/api/v1/research/quadrant",
      {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          conditions, claim, threshold: 0.3, p_label: "温度25-30度", q_label: "高成長率",
          observations: [{ temp: 27, growth: 1 }, { temp: 27, growth: 1 }, { temp: 27 }, { temp: 99, growth: 1 }],
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      gaps: string[]; propositions: { converse: string }; hypothesis_drafts: { quadrant: string }[];
    };
    expect(body.gaps).toContain("n00");
    expect(body.propositions.converse).toBe("高成長率 ⇒ 温度25-30度");
    expect(body.hypothesis_drafts.some((d) => d.quadrant === "n00")).toBe(true);
  });

  it("400s when neither body.claim nor a resolvable paper.claims[0] is available", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const res = await app.request(
      "/api/v1/research/quadrant",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ conditions, observations: [] }) },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("404s on an unknown content_id", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const res = await app.request(
      "/api/v1/research/quadrant",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ content_id: "MISSING", claim }) },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("requires auth (401)", async () => {
    const res = await app.request("/api/v1/research/quadrant", { method: "POST" }, makeEnv());
    expect(res.status).toBe(401);
  });
});
