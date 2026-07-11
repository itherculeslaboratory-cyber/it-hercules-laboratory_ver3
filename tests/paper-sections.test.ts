// PPR-03 paper 検証（design-k5 §4）。content.schema.json の paper 分岐を putEvent 経路
// (validateEnvelope→eventSchemaFor("content")) で成立させる — envelope.ts EVENT_NAMES/
// VALIDATOR_NAME + codegen-validators.mjs SCHEMAS の両所同期(P1)が前提。6 節必須・
// completeness_pct∈[0,100]・LATEX_FORBIDDEN(\ と $)拒否・paper≠content_type を検証。
import { describe, expect, it } from "vitest";
import { TruthStore } from "@ihl/truth";
import { FakeR2Bucket, makeEnvelope } from "./helpers";

const CONTENT_SCHEMA = "schemas/events/content.schema.json";

function section(text = "ok") {
  return { filled: true, text };
}
function sixSections(): Record<string, unknown> {
  return {
    purpose: section(), hypothesis: section(), conditions: section(),
    verification: section(), phase: section(), gap: section(),
  };
}
function paperData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    content_id: "P-1", actor_id: "actor-x", content_type: "paper", title: "T",
    created_at: "2026-07-11T00:00:00Z", schema_version: "1",
    sections: sixSections(), completeness_pct: 50,
    ...overrides,
  };
}
async function put(data: Record<string, unknown>) {
  const env = makeEnvelope({
    type: "ihl.research.content.v1", dataschema: CONTENT_SCHEMA,
    provenance: { generator_kind: "human", actor_id: "actor-x" }, data,
  });
  return new TruthStore(new FakeR2Bucket()).putEvent(env);
}

describe("PPR-03 paper content schema validation via putEvent", () => {
  it("valid paper with 6 sections + completeness in range is inserted", async () => {
    const res = await put(paperData());
    expect(res.status).toBe("inserted");
  });

  it("paper missing one section is rejected (6 sections required)", async () => {
    const s = sixSections();
    delete s.gap;
    const res = await put(paperData({ sections: s }));
    expect(res.status).toBe("invalid");
  });

  it("paper without sections at all is rejected (if/then requires sections)", async () => {
    const d = paperData();
    delete d.sections;
    delete d.completeness_pct;
    const res = await put(d);
    expect(res.status).toBe("invalid");
  });

  it("completeness_pct above 100 is rejected", async () => {
    expect((await put(paperData({ completeness_pct: 150 }))).status).toBe("invalid");
  });

  it("completeness_pct below 0 is rejected", async () => {
    expect((await put(paperData({ completeness_pct: -5 }))).status).toBe("invalid");
  });

  it("LATEX_FORBIDDEN: backslash in a section text is rejected", async () => {
    const s = sixSections();
    s.purpose = section("bad \\alpha");
    expect((await put(paperData({ sections: s }))).status).toBe("invalid");
  });

  it("LATEX_FORBIDDEN: dollar sign in a section text is rejected", async () => {
    const s = sixSections();
    s.hypothesis = section("cost is $5");
    expect((await put(paperData({ sections: s }))).status).toBe("invalid");
  });

  it("LATEX_FORBIDDEN: dollar sign in body_markdown is rejected", async () => {
    expect((await put(paperData({ body_markdown: "price $9" }))).status).toBe("invalid");
  });

  it("non-paper content_type without sections is accepted (then applies only to paper)", async () => {
    const res = await put({
      content_id: "A-1", actor_id: "actor-x", content_type: "article", title: "T",
      created_at: "2026-07-11T00:00:00Z", schema_version: "1", body_markdown: "plain body",
    });
    expect(res.status).toBe("inserted");
  });

  it("unknown content_type is rejected by enum", async () => {
    const res = await put({
      content_id: "X-1", actor_id: "actor-x", content_type: "bogus", title: "T",
      created_at: "2026-07-11T00:00:00Z", schema_version: "1",
    });
    expect(res.status).toBe("invalid");
  });
});
