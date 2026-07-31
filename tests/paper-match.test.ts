// PPR-01/30/06 paper-match pure functions + thin routes (design-k5 §2.3/§2.1/§4).
// matchConditions: satisfied/missing/violated classification + match_rate=satisfied/required
// (required_count=0 -> 1.0). autoFillDescriptor: section fill + claim evidence auto-link,
// unverified claim stays hypothesis, Stage1 mechanical check reuses matchConditions.
// gapAnalysis: injected fixed vectors -> neighbour diff axis -> stable missing_perspectives
// (all-species, no species filter) + data_gap key diff, vector-absent -> data_gap only.
import { describe, expect, it } from "vitest";
import {
  matchConditions,
  autoFillDescriptor,
  gapAnalysis,
  hintsForMissing,
  computeSectionsCompleteness,
  conditionVector,
  computeLivingPaperGraph,
  reviewPipeline,
  computeConfidence,
  canTransitionHypothesis,
  promoteRepresentativeHypothesis,
  buildCitationEdges,
} from "../apps/api/src/paper-match";
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

  it("POST /research/graph/update recomputes match/quadrant/confidence from accumulated observations (V3-PPR-14 Living Paper preview, non-persistent)", async () => {
    const bucket = new FakeR2Bucket();
    const res = await post(bucket, "/api/v1/research/graph/update", {
      conditions: { temp: { min: 25, max: 30, required: true } },
      claims: [{ claim_id: "c1", statement: "warmth helps", evidence_keys: ["temp"] }],
      observations: [{ temp: 27 }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      confidence: number; observation_count: number; persisted: boolean;
      match: { satisfied: string[] }; claims: { status: string }[]; quadrant: { total: number };
    };
    expect(body.persisted).toBe(false);
    expect(body.observation_count).toBe(1);
    expect(body.confidence).toBe(1); // required key satisfied by the single observation
    expect(body.match.satisfied).toEqual(["temp"]);
    expect(body.claims[0].status).toBe("evidenced");
    expect(body.quadrant.total).toBe(1);
  });

  it("POST /research/graph/update confidence rises as more accumulated observations satisfy required keys (append-only fold)", async () => {
    const bucket = new FakeR2Bucket();
    const before = await post(bucket, "/api/v1/research/graph/update", {
      conditions: { temp: { required: true }, humidity: { required: true } },
      observations: [{ temp: 27 }],
    });
    const beforeBody = (await before.json()) as { confidence: number };
    expect(beforeBody.confidence).toBe(0.5);

    const after = await post(bucket, "/api/v1/research/graph/update", {
      conditions: { temp: { required: true }, humidity: { required: true } },
      observations: [{ temp: 27 }, { humidity: 55 }],
    });
    const afterBody = (await after.json()) as { confidence: number };
    expect(afterBody.confidence).toBe(1);
  });

  it("POST /research/graph/update reads conditions/claims from an existing content_id when not overridden inline", async () => {
    const bucket = new FakeR2Bucket();
    const paper = await post(bucket, "/api/v1/research/content", {
      content_id: "PAP-LIVING-1",
      content_type: "paper",
      title: "Living paper study",
      sections: {
        purpose: { filled: true, text: "p" }, hypothesis: { filled: true, text: "h" },
        conditions: { filled: true, text: "c" }, verification: { filled: true, text: "v" },
        phase: { filled: true, text: "ph" }, gap: { filled: true, text: "g" },
      },
      completeness_pct: 50,
      conditions: { temp: { min: 25, max: 30, required: true } },
      claims: [{ claim_id: "c1", statement: "warmth helps", status: "hypothesis", evidence_refs: [] }],
    });
    expect(paper.status).toBe(201);
    const res = await post(bucket, "/api/v1/research/graph/update", {
      content_id: "PAP-LIVING-1",
      observations: [{ temp: 27 }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { confidence: number };
    expect(body.confidence).toBe(1);
  });

  it("POST /research/graph/update is protected (401 without auth)", async () => {
    const bucket = new FakeR2Bucket();
    const res = await app.request(
      "/api/v1/research/graph/update",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      makeEnv(bucket),
    );
    expect(res.status).toBe(401);
  });
});

describe("V3-PPR-14 computeLivingPaperGraph (pure fn)", () => {
  it("no claim -> quadrant defaults to all-zero counts over the observation total", () => {
    const g = computeLivingPaperGraph({ conditions: { temp: { required: true } } }, [{ temp: 27 }, {}]);
    expect(g.quadrant.total).toBe(2);
    expect(g.quadrant.gaps).toEqual([]);
    // merged fold across both observations already satisfies "temp" (first-seen 27 wins).
    expect(g.confidence).toBe(1);
  });

  it("later observations never un-satisfy a key already satisfied by an earlier one (append-only fold)", () => {
    const g = computeLivingPaperGraph(
      { conditions: { temp: { min: 25, max: 30, required: true } } },
      [{ temp: 27 }, { temp: 999 }],
    );
    expect(g.match.satisfied).toEqual(["temp"]); // first-seen 27 wins, not overwritten by 999
    expect(g.confidence).toBe(1);
  });

  // ★2026-07-31 追加(V3-PPR-14 順序依存バグ修正の合格ライン・逆順): 外れ値が先・正常値が後
  // でも、同じ観測集合なら confidence が変わってはいけない(要件は投入順に非依存)。
  it("order-independence: an out-of-range observation followed by an in-range one still satisfies (reverse order)", () => {
    const g = computeLivingPaperGraph(
      { conditions: { temp: { min: 25, max: 30, required: true } } },
      [{ temp: 999 }, { temp: 27 }],
    );
    expect(g.match.satisfied).toEqual(["temp"]);
    expect(g.match.violated).toEqual([]);
    expect(g.confidence).toBe(1);
  });
});

describe("V3-PPR-05 reviewPipeline (段階1-5・決定論・pure fn)", () => {
  it("完全な入力: 構造100・欠損なし・再現性/整合性issueなし", () => {
    const r = reviewPipeline({
      sections: {
        purpose: { filled: true, text: "x" },
        hypothesis: { filled: true, text: "x" },
        conditions: { filled: true, text: "x" },
        verification: { filled: true, text: "x" },
        phase: { filled: true, text: "x" },
        gap: { filled: true, text: "x" },
      },
      conditions: { temp: { min: 25, max: 30, required: true } },
      observation: { temp: 27 },
      measurements: [
        { item: "temp", value: 27, unit: "C" },
        { item: "temp", value: 28, unit: "C" },
      ],
    });
    expect(r.structural_score).toBe(100);
    expect(r.missing_observations).toEqual([]);
    expect(r.reproducibility_issues).toEqual([]);
    expect(r.consistency_issues).toEqual([]);
    expect(r.condition_request_recommended).toBe(false);
  });

  it("欠損・unit未記載・n=1・conditions未計測 を段階2-4で検出する", () => {
    const r = reviewPipeline({
      sections: {},
      conditions: { temp: { min: 25, max: 30, required: true }, humidity: { required: true } },
      observation: {},
      measurements: [{ item: "weight", value: 5 }], // unit無し・n=1・conditionsに無い項目
    });
    expect(r.structural_score).toBe(0);
    expect(r.missing_observations.map((m) => m.key)).toEqual(["humidity", "temp"]);
    expect(r.reproducibility_issues).toContain("weight: unit未記載(再現性を損なう)");
    expect(r.reproducibility_issues).toContain("weight: n=1(反復不足・再現性の主張には最低2点が必要)");
    expect(r.consistency_issues).toEqual([
      "humidity: conditions に定義されているが measurements が無い",
      "temp: conditions に定義されているが measurements が無い",
    ]);
    expect(r.condition_request_recommended).toBe(true);
  });
});

describe("V3-PPR-15 confidence formula + hypothesis state machine (pure fn)", () => {
  it("computeConfidence は f_data/f_consistency/f_votes の既定重み(0.3/0.4/0.3)で合成する", () => {
    // n=100 -> f_data=1-e^(-0.02*100)=1-e^-2≈0.8647。n11=8,n10=2 -> f_consistency=0.8。votes 8up/2down -> f_votes=8/11≈0.7273。
    const c = computeConfidence(100, 8, 2, 8, 2);
    const f_data = 1 - Math.exp(-0.02 * 100);
    const expected = 0.3 * f_data + 0.4 * 0.8 + 0.3 * (8 / 11);
    expect(c).toBeCloseTo(expected, 10);
  });

  it("n=0/votes=0 でも 0 除算せず安全に 0 付近を返す", () => {
    const c = computeConfidence(0, 0, 0, 0, 0);
    expect(Number.isFinite(c)).toBe(true);
    expect(c).toBeGreaterThanOrEqual(0);
  });

  it("draft→hypothesis→supported→archived は許可、draft→supported の飛び越しは禁止", () => {
    expect(canTransitionHypothesis("draft", "hypothesis")).toBe(true);
    expect(canTransitionHypothesis("hypothesis", "supported")).toBe(true);
    expect(canTransitionHypothesis("hypothesis", "rejected")).toBe(true);
    expect(canTransitionHypothesis("supported", "archived")).toBe(true);
    expect(canTransitionHypothesis("draft", "supported")).toBe(false);
    expect(canTransitionHypothesis("archived", "hypothesis")).toBe(false);
  });

  it("promoteRepresentativeHypothesis は supported の中から confidence 最大の1件を選ぶ(同点はid昇順)", () => {
    const best = promoteRepresentativeHypothesis([
      { id: "b", state: "supported", confidence: 0.9 },
      { id: "a", state: "supported", confidence: 0.9 },
      { id: "c", state: "hypothesis", confidence: 0.99 }, // supported でないので除外
    ]);
    expect(best).toEqual({ id: "a", state: "supported", confidence: 0.9 });
  });

  it("supported が1件も無ければ null(誇張ゼロ)", () => {
    expect(promoteRepresentativeHypothesis([{ id: "a", state: "hypothesis", confidence: 0.9 }])).toBeNull();
    expect(promoteRepresentativeHypothesis([])).toBeNull();
  });
});

describe("V3-PPR-08 buildCitationEdges (双方向リンク + tombstone・pure fn)", () => {
  it("実在するtarget_idはtombstone:false、非公開/削除済みはtombstone:true", () => {
    const edges = buildCitationEdges(
      "paper-1",
      [
        { type: "paper", id: "paper-2", label: "他論文" },
        { type: "paper", id: "paper-deleted" },
        { type: "url", id: "https://example.com" },
      ],
      // paper-deleted は実在確認できなかった想定。url/book は自ホストTruth外の参照のため
      // route側が常に existing へ加える(呼び手責務・関数自体は集合演算のみ)。
      new Set(["paper-2", "https://example.com"]),
    );
    expect(edges).toEqual([
      { source_id: "paper-1", target_id: "https://example.com", type: "url", tombstone: false },
      { source_id: "paper-1", target_id: "paper-2", type: "paper", label: "他論文", tombstone: false },
      { source_id: "paper-1", target_id: "paper-deleted", type: "paper", tombstone: true },
    ]);
  });
});

describe("thin routes: /research/review, /research/confidence, /research/hypothesis/*, /research/content/:id/citation-graph", () => {
  function post(bucket: FakeR2Bucket, path: string, body: unknown, headers = AUTH_HEADERS): Promise<Response> {
    return app.request(path, { method: "POST", headers, body: JSON.stringify(body) }, makeEnv(bucket));
  }

  it("POST /research/review returns the 5-stage decision output", async () => {
    const bucket = new FakeR2Bucket();
    const res = await post(bucket, "/api/v1/research/review", {
      conditions: { temp: { required: true } },
      observation: {},
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { structural_score: number; condition_request_recommended: boolean };
    expect(body.structural_score).toBe(0);
    expect(body.condition_request_recommended).toBe(true);
  });

  it("POST /research/confidence returns a 0..1 confidence with default weights echoed", async () => {
    const bucket = new FakeR2Bucket();
    const res = await post(bucket, "/api/v1/research/confidence", { n: 50, n11: 5, n10: 0, votes_up: 3, votes_down: 0 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { confidence: number; weights: { data: number; consistency: number; votes: number; k: number } };
    expect(body.confidence).toBeGreaterThan(0);
    expect(body.confidence).toBeLessThanOrEqual(1);
    expect(body.weights).toEqual({ data: 0.3, consistency: 0.4, votes: 0.3, k: 0.02 });
  });

  it("POST /research/hypothesis/transition rejects an illegal jump", async () => {
    const bucket = new FakeR2Bucket();
    const res = await post(bucket, "/api/v1/research/hypothesis/transition", { from: "draft", to: "archived" });
    expect(res.status).toBe(200);
    expect((await res.json()) as { allowed: boolean }).toMatchObject({ allowed: false });
  });

  it("GET /research/content/:id/citation-graph 404s for an unknown content id", async () => {
    const bucket = new FakeR2Bucket();
    const res = await app.request(
      "/api/v1/research/content/unknown-id/citation-graph",
      { headers: AUTH_HEADERS },
      makeEnv(bucket),
    );
    expect(res.status).toBe(404);
  });

  it("GET /research/content/:id/citation-graph 401s unauthenticated (protected route)", async () => {
    const bucket = new FakeR2Bucket();
    const res = await app.request("/api/v1/research/content/unknown-id/citation-graph", {}, makeEnv(bucket));
    expect(res.status).toBe(401);
  });
});

describe("V3-PPR-14 POST /research/content/:id/fork-template + update-history", () => {
  function post(bucket: FakeR2Bucket, path: string, body: unknown, headers = AUTH_HEADERS): Promise<Response> {
    return app.request(path, { method: "POST", headers, body: JSON.stringify(body) }, makeEnv(bucket));
  }
  function get(bucket: FakeR2Bucket, path: string): Promise<Response> {
    return app.request(path, { headers: AUTH_HEADERS }, makeEnv(bucket));
  }
  async function seedTemplate(bucket: FakeR2Bucket): Promise<void> {
    const res = await post(bucket, "/api/v1/research/content", {
      content_id: "TEMPLATE-1",
      content_type: "paper",
      title: "Template paper",
      sections: {
        purpose: { filled: true, text: "p" }, hypothesis: { filled: false, text: "" },
        conditions: { filled: false, text: "" }, verification: { filled: false, text: "" },
        phase: { filled: false, text: "" }, gap: { filled: false, text: "" },
      },
      completeness_pct: 17,
      conditions: { temp: { min: 25, max: 30, required: true } },
    });
    expect(res.status).toBe(201);
  }

  it("forks sections/conditions from the source paper into a new content, records derived_from lineage + first update-history entry", async () => {
    const bucket = new FakeR2Bucket();
    await seedTemplate(bucket);
    const fork = await post(bucket, "/api/v1/research/content/TEMPLATE-1/fork-template", { title: "My fork" });
    expect(fork.status).toBe(201);
    const forkBody = (await fork.json()) as { content_id: string; forked_from: string };
    expect(forkBody.forked_from).toBe("TEMPLATE-1");

    const forked = await get(bucket, `/api/v1/research/content/${forkBody.content_id}`);
    const forkedBody = (await forked.json()) as { title: string; sections: Record<string, { filled: boolean }> };
    expect(forkedBody.title).toBe("My fork");
    expect(forkedBody.sections.purpose.filled).toBe(true); // copied from template

    const history = await get(bucket, `/api/v1/research/content/${forkBody.content_id}/update-history`);
    const historyBody = (await history.json()) as { updates: { triggered_by: string }[] };
    expect(historyBody.updates.length).toBe(1);
    expect(historyBody.updates[0].triggered_by).toBe("template_fork:TEMPLATE-1");
  });

  it("fork-template 404s for an unknown source id, 400s for a non-paper source", async () => {
    const bucket = new FakeR2Bucket();
    const notFound = await post(bucket, "/api/v1/research/content/nope/fork-template", {});
    expect(notFound.status).toBe(404);

    await post(bucket, "/api/v1/research/content", {
      content_id: "ART-1", content_type: "article", title: "not a paper",
    });
    const wrongType = await post(bucket, "/api/v1/research/content/ART-1/fork-template", {});
    expect(wrongType.status).toBe(400);
  });
});

describe("V3-PPR-24/25 POST/GET /research/cycle-nodes (append-only, no update/delete route)", () => {
  function post(bucket: FakeR2Bucket, path: string, body: unknown, headers = AUTH_HEADERS): Promise<Response> {
    return app.request(path, { method: "POST", headers, body: JSON.stringify(body) }, makeEnv(bucket));
  }
  function get(bucket: FakeR2Bucket, path: string): Promise<Response> {
    return app.request(path, { headers: AUTH_HEADERS }, makeEnv(bucket));
  }

  it("rejects an unknown node_type (only the 8 design35 §A-5 values are accepted)", async () => {
    const bucket = new FakeR2Bucket();
    const res = await post(bucket, "/api/v1/research/cycle-nodes", { node_type: "not_a_real_type" });
    expect(res.status).toBe(400);
  });

  it("knowledge_evidence keeps leading_hypotheses as an array (multiple co-existing theories, no single-winner field)", async () => {
    const bucket = new FakeR2Bucket();
    const created = await post(bucket, "/api/v1/research/cycle-nodes", {
      node_type: "knowledge_evidence",
      subject_ref: { type: "individual", id: "IND-1" },
      sections: { leading_hypotheses: ["theory A", "theory B"] },
    });
    expect(created.status).toBe(201);
    const { node_id } = (await created.json()) as { node_id: string };
    const detail = await get(bucket, `/api/v1/research/cycle-nodes/${node_id}`);
    const body = (await detail.json()) as { sections: { leading_hypotheses: string[] } };
    expect(body.sections.leading_hypotheses).toEqual(["theory A", "theory B"]);
  });

  it("GET /research/cycle-nodes filters by node_type and subject_id", async () => {
    const bucket = new FakeR2Bucket();
    await post(bucket, "/api/v1/research/cycle-nodes", {
      node_type: "hypothesis", subject_ref: { type: "paper", id: "P-1" },
    });
    await post(bucket, "/api/v1/research/cycle-nodes", {
      node_type: "comment", subject_ref: { type: "paper", id: "P-1" },
    });
    await post(bucket, "/api/v1/research/cycle-nodes", {
      node_type: "hypothesis", subject_ref: { type: "paper", id: "P-2" },
    });
    const byType = await get(bucket, "/api/v1/research/cycle-nodes?node_type=hypothesis");
    expect(((await byType.json()) as { items: unknown[] }).items.length).toBe(2);
    const bySubject = await get(bucket, "/api/v1/research/cycle-nodes?subject_id=P-1");
    expect(((await bySubject.json()) as { items: unknown[] }).items.length).toBe(2);
    const both = await get(bucket, "/api/v1/research/cycle-nodes?node_type=hypothesis&subject_id=P-1");
    expect(((await both.json()) as { items: unknown[] }).items.length).toBe(1);
  });
});
