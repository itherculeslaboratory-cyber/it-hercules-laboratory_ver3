// V3-PPR-20 — 論文の観察項目・測定単位・条件を統一データフォーマット(measurements[]=
// item/value/unit・obs-capture.schema.jsonと同一形状)として標準化し、データのみから
// 論文下書き(conditions節)を自動生成する。PaperSectionsV1(PPR-03実装済み)の拡張として
// 提供し、別データフォーマットは新設しない。
import { describe, expect, it } from "vitest";
import { summarizeUnifiedMeasurements, autoGeneratePaperDraft } from "../apps/api/src/paper-match";
import app from "../apps/api/src/index";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

describe("summarizeUnifiedMeasurements", () => {
  it("aggregates min/max/mean/n per item across observations", () => {
    const s = summarizeUnifiedMeasurements([
      { measurements: [{ item: "horn_length", value: 80, unit: "mm" }] },
      { measurements: [{ item: "horn_length", value: 90, unit: "mm" }] },
      { measurements: [{ item: "weight", value: 30 }] },
    ]);
    expect(s.horn_length).toMatchObject({ min: 80, max: 90, mean: 85, n: 2, unit: "mm" });
    expect(s.weight).toMatchObject({ min: 30, max: 30, mean: 30, n: 1 });
  });

  it("ignores non-numeric / missing values", () => {
    const s = summarizeUnifiedMeasurements([{ measurements: [{ item: "x", value: "not-a-number" as unknown as number }] }]);
    expect(s.x).toBeUndefined();
  });
});

describe("autoGeneratePaperDraft (data-only paper generation, PPR-20)", () => {
  it("auto-fills the conditions section from unified measurement data, leaves narrative sections unfilled", () => {
    const draft = autoGeneratePaperDraft(
      [{ measurements: [{ item: "horn_length", value: 80, unit: "mm" }] }, { measurements: [{ item: "horn_length", value: 90, unit: "mm" }] }],
      { title: "Horn length study" },
    );
    expect(draft.sections.conditions.filled).toBe(true);
    expect(draft.sections.conditions.text).toContain("horn_length");
    expect(draft.conditions.horn_length).toMatchObject({ min: 80, max: 90, required: true, unit: "mm" });
    // machine never fabricates purpose/hypothesis/phase/gap narrative (invariant 5)
    expect(draft.sections.purpose.filled).toBe(false);
    expect(draft.sections.hypothesis.filled).toBe(false);
    expect(draft.completeness_pct).toBeGreaterThan(0);
    expect(draft.completeness_pct).toBeLessThan(100);
  });

  it("with zero observations, completeness is 0 and conditions is unfilled+empty", () => {
    const draft = autoGeneratePaperDraft([], { title: "empty" });
    expect(draft.completeness_pct).toBe(0);
    expect(draft.conditions).toEqual({});
    expect(draft.sections.conditions.filled).toBe(false);
  });
});

describe("POST /api/v1/research/auto-draft", () => {
  it("returns a non-persisted draft (persisted:false)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const res = await app.request(
      "/api/v1/research/auto-draft",
      {
        method: "POST", headers: AUTH_HEADERS,
        body: JSON.stringify({ title: "T", observations: [{ measurements: [{ item: "weight", value: 30, unit: "g" }] }] }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { persisted: boolean; conditions: Record<string, unknown> };
    expect(body.persisted).toBe(false);
    expect(body.conditions.weight).toMatchObject({ min: 30, max: 30, required: true, unit: "g" });
  });

  it("requires auth (401)", async () => {
    const res = await app.request("/api/v1/research/auto-draft", { method: "POST" }, makeEnv());
    expect(res.status).toBe(401);
  });
});
