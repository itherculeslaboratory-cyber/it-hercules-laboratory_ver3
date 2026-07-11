// V3-AIP-45 two-layer view schema + reference counter projection (design-k8 §3).
// ai-view.schema.json validates human_view + machine_view (sections/keypoints/
// entities/topics/rag_chunk/importance) + 3-layer tags. importance is bounded 0..1.
// projectReferenceCounter recomputes a target's reference count from the event
// stream every call (NOT a stored counter — invariant clause 1).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { TruthStore, ulid } from "@ihl/truth";
import { projectReferenceCounter } from "../apps/api/src/reference-counter";
import { FakeR2Bucket, makeEnvelope } from "./helpers";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(fileURLToPath(new URL("../package.json", import.meta.url)));
const Ajv2020 = require("ajv/dist/2020.js");

function compileAiView() {
  const ajv = new (Ajv2020.default ?? Ajv2020)({ allErrors: true, strict: false });
  const schema = JSON.parse(readFileSync(`${ROOT}/schemas/defs/ai-view.schema.json`, "utf8"));
  return ajv.compile(schema);
}

const validView = {
  human_view: "One-paragraph human summary of the document.",
  machine_view: {
    sections: ["Intro", "Method", "Result"],
    keypoints: ["append-only", "recomputed projections"],
    entities: [{ name: "TruthStore", type: "class" }, { name: "R2" }],
    topics: ["storage", "provenance"],
    rag_chunk: "Intro ... Method ... Result ...",
    importance: 0.75,
  },
  tags: { system: ["k8"], ai: ["summarized"], user: ["review-later"] },
};

describe("V3-AIP-45 ai-view.schema.json", () => {
  it("accepts a fully populated two-layer view", () => {
    const validate = compileAiView();
    expect(validate(validView), JSON.stringify(validate.errors)).toBe(true);
  });

  it("accepts machine_view with only the required sections + keypoints", () => {
    const validate = compileAiView();
    const minimal = {
      human_view: "s",
      machine_view: { sections: ["a"], keypoints: ["b"] },
      tags: { system: [], ai: [], user: [] },
    };
    expect(validate(minimal), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects importance above 1 (bounded 0..1)", () => {
    const validate = compileAiView();
    const bad = { ...validView, machine_view: { ...validView.machine_view, importance: 1.5 } };
    expect(validate(bad)).toBe(false);
  });

  it("rejects importance below 0 (bounded 0..1)", () => {
    const validate = compileAiView();
    const bad = { ...validView, machine_view: { ...validView.machine_view, importance: -0.1 } };
    expect(validate(bad)).toBe(false);
  });

  it("rejects a tag layer that is not a string array", () => {
    const validate = compileAiView();
    const bad = { ...validView, tags: { system: ["k8"], ai: "summarized", user: [] } };
    expect(validate(bad)).toBe(false);
  });

  it("rejects an entity missing its required name", () => {
    const validate = compileAiView();
    const bad = { ...validView, machine_view: { ...validView.machine_view, entities: [{ type: "class" }] } };
    expect(validate(bad)).toBe(false);
  });
});

describe("V3-AIP-45 projectReferenceCounter (recomputed, not stored)", () => {
  it("counts events that cite the target in provenance.input_event_ids", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    const target = ulid();
    const other = ulid();

    // 3 events reference the target via lineage; 2 do not.
    for (let i = 0; i < 3; i++) {
      await s.putEvent(makeEnvelope({
        id: ulid(),
        provenance: { generator_kind: "agent", agent_name: "claude-code", input_event_ids: [target] },
      }));
    }
    await s.putEvent(makeEnvelope({ id: ulid() })); // no input_event_ids
    await s.putEvent(makeEnvelope({
      id: ulid(),
      provenance: { generator_kind: "agent", agent_name: "claude-code", input_event_ids: [other] },
    }));

    expect(await projectReferenceCounter(s, target)).toBe(3);
    expect(await projectReferenceCounter(s, other)).toBe(1);
    expect(await projectReferenceCounter(s, ulid())).toBe(0);
  });
});
