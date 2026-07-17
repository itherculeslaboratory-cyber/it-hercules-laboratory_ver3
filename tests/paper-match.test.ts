// PPR-01/30/06 paper-match pure functions + thin routes (design-k5 §2.3/§2.1/§4).
// matchConditions: satisfied/missing/violated classification + match_rate=satisfied/required
// (required_count=0 -> 1.0). autoFillDescriptor: section fill + claim evidence auto-link,
// unverified claim stays hypothesis, Stage1 mechanical check reuses matchConditions.
// gapAnalysis: injected fixed vectors -> neighbour diff axis -> stable missing_perspectives
// (all-species, no species filter) + data_gap key diff, vector-absent -> data_gap only.
import { describe, expect, it } from "vitest";
import { matchConditions, autoFillDescriptor, gapAnalysis, hintsForMissing, computeSectionsCompleteness, conditionVector } from "../apps/api/src/paper-match";
import app from "../apps/api/src/index";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

describe("PPR-01 matchConditions classification + match_rate", () => {
  const conditions = {
    temp: { min: 25, max: 30, required: true },
    humidity: { min: 40, required: true },
    density: { max: 10, required: false }, // not required -> excluded from denominator
  };

  it("all required satisfied -> match_rate 1.0, no missing/violated", () => {
    const r = matchConditions(conditions, { temp: 27, humidity: 55, density: 99 });
    expect(r.satisfied).toEqual(["humidity", "temp"]); // key asc, required only
    expect(r.missing).toEqual([]);
    expect(r.violated).toEqual([]);
    expect(r.required_count).toBe(2); // density excluded (required:false)
    expect(r.match_rate).toBe(1);
  });

  it("partial: one required key absent -> missing + match_rate 0.5", () => {
    const r = matchConditions(conditions, { temp: 27 });
    expect(r.satisfied).toEqual(["temp"]);
    expect(r.missing).toEqual(["humidity"]);
    expect(r.violated).toEqual([]);
    expect(r.match_rate).toBe(0.5);
  });

  it("violated: observed value out of range -> violated + match_rate 0.5", () => {
    const r = matchConditions(conditions, { temp: 99, humidity: 55 });
    expect(r.satisfied).toEqual(["humidity"]);
    expect(r.violated).toEqual(["temp"]);
    expect(r.missing).toEqual([]);
    expect(r.match_rate).toBe(0.5);
  });

  it("eq condition matches exactly, non-numeric observation is violated", () => {
    const c = { ph: { eq: 7, required: true } };
    expect(matchConditions(c, { ph: 7 }).satisfied).toEqual(["ph"]);
    expect(matchConditions(c, { ph: 8 }).violated).toEqual(["ph"]);
    expect(matchConditions(c, { ph: "abc" }).violated).toEqual(["ph"]);
  });

  it("required_count=0 yields match_rate 1.0 (no required keys)", () => {
    const r = matchConditions({ a: { required: false } }, {});
    expect(r.required_count).toBe(0);
    expect(r.match_rate).toBe(1);
  });
});

describe("PPR-02 conditionVector — normalize条件P to key+value+unit+missing (single schema source)", () => {
  const conditions = {
    temp: { min: 25, max: 30, required: true, unit: "C" },
    humidity: { min: 40, required: true }, // no unit -> null
    density: { max: 10, required: false },
  };

  it("lists ALL condition keys (required and optional) key-asc, not just required", () => {
    const v = conditionVector(conditions, { temp: 27, humidity: 55, density: 3 });
    expect(v.map((e) => e.key)).toEqual(["density", "humidity", "temp"]); // key asc, includes optional
  });

  it("present numeric observation -> value set, missing=false; unit passthrough or null", () => {
    const v = conditionVector(conditions, { temp: 27, humidity: 55, density: 3 });
    expect(v.find((e) => e.key === "temp")).toEqual({ key: "temp", value: 27, unit: "C", missing: false });
    expect(v.find((e) => e.key === "humidity")).toEqual({ key: "humidity", value: 55, unit: null, missing: false });
  });

  it("absent key -> missing=true, value=null (欠損フラグ)", () => {
    const v = conditionVector(conditions, { temp: 27 });
    expect(v.find((e) => e.key === "humidity")).toEqual({ key: "humidity", value: null, unit: null, missing: true });
  });

  it("non-numeric observed value -> value=null but missing=false (present, just not numeric)", () => {
    const v = conditionVector(conditions, { temp: "warm" });
    expect(v.find((e) => e.key === "temp")).toEqual({ key: "temp", value: null, unit: "C", missing: false });
  });
});

describe("PPR-01 hintsForMissing — deterministic RAG-style range hints (no LLM)", () => {
  const conditions = {
    temp: { min: 25, max: 30, required: true, unit: "C" },
    humidity: { min: 40, required: true },
    ph: { eq: 7, required: true },
    density: { required: true }, // no min/max/eq -> no range synthesizable
  };

  it("synthesizes a range string from min/max/unit", () => {
    const hints = hintsForMissing(conditions, ["temp"]);
    expect(hints).toEqual([{ key: "temp", range: "25以上・30以下C" }]);
  });

  it("min-only and eq-only conditions still produce a range", () => {
    expect(hintsForMissing(conditions, ["humidity"])[0].range).toBe("40以上");
    expect(hintsForMissing(conditions, ["ph"])[0].range).toBe("7");
  });

  it("a condition with no min/max/eq omits range (no fabricated hint)", () => {
    expect(hintsForMissing(conditions, ["density"])[0]).toEqual({ key: "density" });
  });

  it("preserves the order of the missing[] input", () => {
    expect(hintsForMissing(conditions, ["ph", "temp"]).map((h) => h.key)).toEqual(["ph", "temp"]);
  });
});

describe("PPR-03 computeSectionsCompleteness — PAPER_SECTIONS-driven projection skeleton", () => {
  it("all 6 sections filled -> 100", () => {
    const sections = Object.fromEntries(
      ["purpose", "hypothesis", "conditions", "verification", "phase", "gap"].map((k) => [k, { filled: true, text: "x" }]),
    );
    expect(computeSectionsCompleteness(sections)).toBe(100);
  });

  it("3 of 6 filled -> 50", () => {
    const sections = {
      purpose: { filled: true, text: "" }, hypothesis: { filled: true, text: "" }, conditions: { filled: true, text: "" },
      verification: { filled: false, text: "" }, phase: { filled: false, text: "" }, gap: { filled: false, text: "" },
    };
    expect(computeSectionsCompleteness(sections)).toBe(50);
  });

  it("undefined sections -> 0 (no crash on non-paper content)", () => {
    expect(computeSectionsCompleteness(undefined)).toBe(0);
  });
});

describe("PPR-30 autoFillDescriptor section fill + claim evidence link", () => {
  const conditions = { temp: { min: 25, max: 30, required: true }, humidity: { min: 40, required: true } };

  it("satisfied keys -> claim evidenced with evidence_refs; Stage1 reuses matchConditions", () => {
    const d = autoFillDescriptor(
      {
        conditions,
        claims: [{ claim_id: "cl-1", statement: "growth improves", evidence_keys: ["temp", "humidity"] }],
      },
      { temp: 27, humidity: 55 },
    );
    // Stage1 mechanical check == matchConditions on same input.
    expect(d.match).toEqual(matchConditions(conditions, { temp: 27, humidity: 55 }));
    expect(d.claims[0].status).toBe("evidenced");
    expect(d.claims[0].evidence_refs).toEqual(["humidity", "temp"]); // sorted
    // verification section auto-filled when all required met.
    expect(d.sections.verification.filled).toBe(true);
    expect(d.sections.verification.text).toContain("humidity");
  });

  it("unverified claim stays hypothesis (evidence keys not all satisfied)", () => {
    const d = autoFillDescriptor(
      { conditions, claims: [{ claim_id: "cl-2", statement: "x", evidence_keys: ["temp", "humidity"] }] },
      { temp: 27 }, // humidity missing
    );
    expect(d.claims[0].status).toBe("hypothesis");
    expect(d.claims[0].evidence_refs).toEqual([]);
    expect(d.sections.verification.filled).toBe(false);
  });

  it("claim with no evidence_keys is a fixed hypothesis (machine never auto-evidences)", () => {
    const d = autoFillDescriptor(
      { conditions, claims: [{ claim_id: "cl-3", statement: "speculation" }] },
      { temp: 27, humidity: 55 },
    );
    expect(d.claims[0].status).toBe("hypothesis");
    expect(d.claims[0].evidence_refs).toEqual([]);
  });
});

describe("PPR-06 gapAnalysis all-species neighbour diff + data_gap", () => {
  const paper = {
    conditions: { temp: { required: true }, humidity: { required: true } },
    vector: [1, 0, 0],
  };
  // Fixed injected vectors: near neighbour shares direction, far one is orthogonal.
  // Neighbours are across species (no species field) -> proves no species filter.
  const neighbors = [
    { content_id: "near", conditions: { temp: { required: true }, food: { required: true } }, vector: [0.9, 0.1, 0] },
    { content_id: "far", conditions: { ethics: { required: true } }, vector: [0, 0, 1] },
  ];

  it("data_gap = required keys minus observed keys (sorted)", () => {
    const g = gapAnalysis(paper, neighbors, { temp: 27 });
    expect(g.data_gap).toEqual(["humidity"]); // temp observed, humidity not
  });

  it("semantic_gap = top-neighbour condition keys minus paper keys; missing_perspectives stable sorted", () => {
    const g = gapAnalysis(paper, neighbors, { temp: 27, humidity: 55 });
    // both required observed -> data_gap empty; semantic axis from neighbours.
    expect(g.data_gap).toEqual([]);
    // near+far unioned condition keys minus paper keys {temp,humidity} = {food, ethics}.
    expect(g.semantic_gap).toEqual(["ethics", "food"]);
    expect(g.missing_perspectives).toEqual(["ethics", "food"]); // union sorted, deterministic
  });

  it("no vector -> semantic_gap empty, returns data_gap only (embedding OFF still works)", () => {
    const g = gapAnalysis({ conditions: paper.conditions }, neighbors, {});
    expect(g.semantic_gap).toEqual([]);
    expect(g.data_gap).toEqual(["humidity", "temp"]);
    expect(g.missing_perspectives).toEqual(["humidity", "temp"]);
  });
});

// Thin-route wiring: prove the three §2.1 routes are mounted, protected, and append-only.
describe("paper-match routes wiring (protected, append-only hypothesis)", () => {
  function post(bucket: FakeR2Bucket, path: string, body: unknown, headers = AUTH_HEADERS): Promise<Response> {
    return app.request(path, { method: "POST", headers, body: JSON.stringify(body) }, makeEnv(bucket));
  }

  it("POST /research/paper-match returns match + hint for inline conditions", async () => {
    const bucket = new FakeR2Bucket();
    const res = await post(bucket, "/api/v1/research/paper-match", {
      conditions: { temp: { min: 25, max: 30, required: true } },
      observation: { temp: 99 },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { match: { violated: string[] }; hint: string };
    expect(body.match.violated).toEqual(["temp"]);
    expect(typeof body.hint).toBe("string");
  });

  it("hint text includes the recommended range for a missing key with min/max (V3-PPR-01 RAG hint)", async () => {
    const bucket = new FakeR2Bucket();
    const res = await post(bucket, "/api/v1/research/paper-match", {
      conditions: { humidity: { min: 40, max: 70, required: true, unit: "%" } },
      observation: {},
    });
    const body = (await res.json()) as { hint: string; hints: Array<{ key: string; range?: string }> };
    expect(body.hint).toContain("推奨レンジ");
    expect(body.hints).toEqual([{ key: "humidity", range: "40以上・70以下%" }]);
  });

  it("llm_advice is null when not requested (LLM stays off by default)", async () => {
    const bucket = new FakeR2Bucket();
    const res = await post(bucket, "/api/v1/research/paper-match", {
      conditions: { temp: { required: true } }, observation: {},
    });
    const body = (await res.json()) as { llm_advice: string | null };
    expect(body.llm_advice).toBeNull();
  });

  it("llm_advice stays null (AI_DISABLED) even when explicitly requested — no fabricated answer, no real key wired", async () => {
    const bucket = new FakeR2Bucket();
    const res = await post(bucket, "/api/v1/research/paper-match", {
      conditions: { temp: { required: true } }, observation: {}, llm_advice: true,
    });
    expect(res.status).toBe(200); // the route itself doesn't fail; AI Kernel absorbs AiDisabledError
    const body = (await res.json()) as { llm_advice: string | null };
    expect(body.llm_advice).toBeNull();
  });

  it("POST /research/gap returns data_gap for a paper without vectors", async () => {
    const bucket = new FakeR2Bucket();
    const res = await post(bucket, "/api/v1/research/gap", {
      paper: { conditions: { temp: { required: true }, humidity: { required: true } } },
      observation: { temp: 27 },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data_gap: string[]; semantic_gap: string[] };
    expect(body.data_gap).toEqual(["humidity"]);
    expect(body.semantic_gap).toEqual([]);
  });

  it("POST /research/content/:id/hypothesis appends a new content event with claim status", async () => {
    const bucket = new FakeR2Bucket();
    // Seed a paper with conditions.
    const paper = await post(bucket, "/api/v1/research/content", {
      content_id: "PAP-1",
      content_type: "paper",
      title: "Growth study",
      sections: {
        purpose: { filled: true, text: "p" }, hypothesis: { filled: true, text: "h" },
        conditions: { filled: true, text: "c" }, verification: { filled: true, text: "v" },
        phase: { filled: true, text: "ph" }, gap: { filled: true, text: "g" },
      },
      completeness_pct: 50,
      conditions: { temp: { min: 25, max: 30, required: true } },
    });
    expect(paper.status).toBe(201);

    // Observation satisfies the required condition -> evidenced.
    const res = await post(bucket, "/api/v1/research/content/PAP-1/hypothesis", {
      statement: "warmth helps",
      evidence_keys: ["temp"],
      observation: { temp: 27 },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { content_id: string; paper_id: string; claim: { status: string; evidence_refs: string[] } };
    expect(body.paper_id).toBe("PAP-1");
    expect(body.claim.status).toBe("evidenced");
    expect(body.claim.evidence_refs).toEqual(["temp"]);
    // Appended as a distinct content event (not an update of the paper).
    expect(body.content_id).not.toBe("PAP-1");

    // Missing observation -> hypothesis fixed.
    const res2 = await post(bucket, "/api/v1/research/content/PAP-1/hypothesis", {
      statement: "guess", evidence_keys: ["temp"], observation: {},
    });
    const body2 = (await res2.json()) as { claim: { status: string } };
    expect(body2.claim.status).toBe("hypothesis");
  });

  it("hypothesis route is protected (401 without auth)", async () => {
    const bucket = new FakeR2Bucket();
    const res = await app.request(
      "/api/v1/research/content/PAP-1/hypothesis",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      makeEnv(bucket),
    );
    expect(res.status).toBe(401);
  });
});
