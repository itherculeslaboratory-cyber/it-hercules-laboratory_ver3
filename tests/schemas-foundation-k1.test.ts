// C5 K1 schemas-and-foundation: prove the 14 new event schemas are WIRED into
// validateEnvelope (envelope.ts EVENT_NAMES + VALIDATOR_NAME + codegen SCHEMAS).
// If a schema is missing from EVENT_NAMES, validateEnvelope skips data validation
// and putEvent would store malformed data at 202 permanently (Truth is INSERT
// ONLY — unfixable). So each "rejects invalid data" case is the wiring guard.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateEnvelope } from "@ihl/truth";
import { CONFIDENCE_ORDER } from "../apps/api/src/observation-constants";
import { makeEnvelope } from "./helpers";

const AT = "2026-07-11T00:00:00Z";

function check(kebab: string, data: unknown) {
  return validateEnvelope(
    makeEnvelope({ dataschema: `schemas/events/${kebab}.schema.json`, data }),
  );
}

// [kebab schema, valid data, invalid mutation that must be REJECTED]
const CASES: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
  [
    "ind-master",
    { individual_id: "i1", actor_id: "a1", created_at: AT },
    { actor_id: "a1", created_at: AT }, // missing individual_id
  ],
  [
    "ind-cross-parent",
    { child_id: "c1", parent_id: "p1", parent_role: "sire", actor_id: "a1", created_at: AT },
    { child_id: "c1", parent_id: "p1", parent_role: "uncle", actor_id: "a1", created_at: AT }, // bad enum
  ],
  [
    "ind-name-event",
    { individual_id: "i1", name: "Rex", actor_id: "a1", created_at: AT },
    { individual_id: "i1", actor_id: "a1", created_at: AT }, // missing name
  ],
  [
    "ind-brand-template",
    { brand_template_id: "b1", pattern: "P-###", active: true, actor_id: "a1", created_at: AT },
    { brand_template_id: "b1", pattern: "P-###", active: "yes", actor_id: "a1", created_at: AT }, // active not bool
  ],
  [
    "ind-life-event",
    { individual_id: "i1", kind: "birth", at: AT, actor_id: "a1" },
    { individual_id: "i1", kind: "nap", at: AT, actor_id: "a1" }, // bad enum
  ],
  [
    "taxon-species",
    { species_id: "s1", name: "Dynastes", actor_id: "a1" },
    { species_id: "s1", actor_id: "a1" }, // missing name
  ],
  [
    "taxon-morph",
    { morph_id: "m1", species_id: "s1", name: "albino", actor_id: "a1" },
    { morph_id: "m1", name: "albino", actor_id: "a1" }, // missing species_id
  ],
  [
    "taxon-alias",
    { alias_id: "al1", canonical_species_id: "s1", alias_text: "hercules", approved_by: "a1", actor_id: "a1" },
    { alias_id: "al1", canonical_species_id: "s1", alias_text: "hercules", actor_id: "a1" }, // missing approved_by
  ],
  [
    "match-preference",
    { pref_id: "pr1", actor_id: "a1", item_id: "it1", kind: "swipe", y: 1, features: [0.1, 0.2], created_at: AT },
    { pref_id: "pr1", actor_id: "a1", item_id: "it1", kind: "swipe", y: 0, features: [0.1], created_at: AT }, // y not in {1,-1}
  ],
  [
    "obs-schedule",
    { schedule_id: "sc1", individual_id: "i1", next_observation_at: AT, actor_id: "a1" },
    { schedule_id: "sc1", individual_id: "i1", actor_id: "a1" }, // missing next_observation_at
  ],
  [
    "obs-device",
    { device_id: "d1", provider: "switchbot", display_name: "Meter", actor_id: "a1" },
    { device_id: "d1", display_name: "Meter", actor_id: "a1" }, // missing provider
  ],
  [
    "obs-annotation",
    { annotation_id: "an1", capture_id: "cap1", ast: { label: "x" }, actor_id: "a1" },
    { annotation_id: "an1", capture_id: "cap1", actor_id: "a1" }, // missing ast
  ],
  [
    "obs-analysis",
    { analysis_id: "ay1", capture_id: "cap1", results: {}, correction_semver: "1.0.0", is_manual_edit: false, actor_id: "a1" },
    { analysis_id: "ay1", capture_id: "cap1", results: {}, correction_semver: "v1", is_manual_edit: false, actor_id: "a1" }, // bad semver
  ],
  [
    "cusb-ingest",
    { input_kind: "sensor", payload_hash: "h1", lineage: {}, semantic: {}, actor_id: "a1" },
    { input_kind: "telepathy", payload_hash: "h1", lineage: {}, semantic: {}, actor_id: "a1" }, // bad enum
  ],
];

describe("C5 K1 new event schemas are wired into validateEnvelope", () => {
  it.each(CASES)("%s: valid data passes, invalid data is rejected", (kebab, good, bad) => {
    expect(check(kebab, good).valid).toBe(true);
    const r = check(kebab, bad);
    expect(r.valid).toBe(false); // if this passes, EVENT_NAMES wiring is missing
    expect(r.errors.some((e) => e.startsWith(`data (${kebab})`))).toBe(true);
  });

  it("rejects unknown extra properties (additionalProperties:false)", () => {
    const bad = { individual_id: "i1", actor_id: "a1", created_at: AT, growth_curve: [1, 2] };
    expect(check("ind-master", bad).valid).toBe(false);
  });
});

describe("obs-capture / obs-template additive-optional changes (no regression)", () => {
  it("capture WITHOUT value_origin still valid; bad value_origin enum rejected", () => {
    const base = { capture_id: "c1", actor_id: "a1", domain: "biology", measurements: [{ item: "len", kind: "number", value: 5 }] };
    expect(check("obs-capture", base).valid).toBe(true);
    const withVo = { ...base, measurements: [{ item: "len", kind: "number", value: 5, value_origin: "direct_observed" }] };
    expect(check("obs-capture", withVo).valid).toBe(true);
    const badVo = { ...base, measurements: [{ item: "len", kind: "number", value: 5, value_origin: "vibes" }] };
    expect(check("obs-capture", badVo).valid).toBe(false);
  });

  it("template WITHOUT scope still valid; bad instar enum rejected", () => {
    const base = { template_id: "t1", actor_id: "a1", title: "T", items: [{ label: "len", kind: "number" }] };
    expect(check("obs-template", base).valid).toBe(true);
    const withScope = { ...base, scope: { sex: "female", instar: "third_late" } };
    expect(check("obs-template", withScope).valid).toBe(true);
    const badScope = { ...base, scope: { instar: "fourth" } };
    expect(check("obs-template", badScope).valid).toBe(false);
  });
});

describe("CONFIDENCE_ORDER is total over the frozen provenance value_origin enum", () => {
  it("every value_origin has a grade (批評家#2 — no undefined for OBS-07)", () => {
    const provenance = JSON.parse(
      readFileSync(new URL("../schemas/frozen/provenance.schema.json", import.meta.url), "utf8"),
    );
    const enumValues: string[] = provenance.properties.value_origin.enum;
    expect(enumValues.length).toBe(9);
    for (const v of enumValues) {
      expect(CONFIDENCE_ORDER[v as keyof typeof CONFIDENCE_ORDER]).toBeTruthy();
    }
  });
});
