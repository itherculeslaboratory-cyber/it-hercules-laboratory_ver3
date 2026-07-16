// PPR-03 paper 検証（design-k5 §4）。content.schema.json の paper 分岐を putEvent 経路
// (validateEnvelope→eventSchemaFor("content")) で成立させる — envelope.ts EVENT_NAMES/
// VALIDATOR_NAME + codegen-validators.mjs SCHEMAS の両所同期(P1)が前提。6 節必須・
// completeness_pct∈[0,100]・LATEX_FORBIDDEN(\ と $)拒否・paper≠content_type を検証。
import { describe, expect, it } from "vitest";
import { TruthStore } from "@ihl/truth";
import app from "../apps/api/src/index";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv, makeEnvelope } from "./helpers";

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

describe("PPR-03 sections_completeness_pct projection (design_only skeleton)", () => {
  it("GET /research/content/:id computes sections_completeness_pct from filled flags", async () => {
    const bucket = new FakeR2Bucket();
    const s: Record<string, { filled: boolean; text: string }> = Object.fromEntries(
      ["purpose", "hypothesis", "conditions"].map((k) => [k, { filled: true, text: "x" }]),
    );
    for (const k of ["verification", "phase", "gap"]) s[k] = { filled: false, text: "" };
    const created = await app.request(
      "/api/v1/research/content",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ content_id: "P-COMPLETE", content_type: "paper", title: "T", sections: s, completeness_pct: 10 }) },
      makeEnv(bucket),
    );
    expect(created.status).toBe(201);
    const res = await app.request("/api/v1/research/content/P-COMPLETE", { headers: AUTH_HEADERS }, makeEnv(bucket));
    const body = (await res.json()) as { completeness_pct: number; sections_completeness_pct: number };
    // stored value is untouched (append-only) even though it disagrees with the computed one.
    expect(body.completeness_pct).toBe(10);
    // computed value is the actual 3-of-6 filled ratio, independent of the stored input.
    expect(body.sections_completeness_pct).toBe(50);
  });

  it("non-paper content has no sections_completeness_pct field", async () => {
    const bucket = new FakeR2Bucket();
    await app.request(
      "/api/v1/research/content",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ content_id: "A-PLAIN", content_type: "article", title: "T" }) },
      makeEnv(bucket),
    );
    const res = await app.request("/api/v1/research/content/A-PLAIN", { headers: AUTH_HEADERS }, makeEnv(bucket));
    const body = (await res.json()) as Record<string, unknown>;
    expect("sections_completeness_pct" in body).toBe(false);
  });
});
