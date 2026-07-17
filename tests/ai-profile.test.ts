// V3-AIP-40 ai-profile contract (design-k8 §1.3, §3).
// Every ai-profiles/*.json validates against ai-profile.schema.json; all 5 AI
// features carry a profile; profiles are BYOK-only (byok:true, no server-held
// default API key field — V3-SEC, LLM default OFF / invariant clause 1).
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(fileURLToPath(new URL("../package.json", import.meta.url)));
const Ajv2020 = require("ajv/dist/2020.js");

const AI_FEATURES = ["image-analysis", "rag", "newspaper", "translation", "market"];
// Server-side key fields that a BYOK profile must NEVER carry (V3-SEC).
const SERVER_KEY_FIELDS = [
  "api_key", "apiKey", "server_key", "serverKey", "default_key", "defaultKey",
  "secret", "secret_key", "token", "access_token", "key",
];

function compileProfile() {
  const ajv = new (Ajv2020.default ?? Ajv2020)({ allErrors: true, strict: false });
  const schema = JSON.parse(readFileSync(`${ROOT}/schemas/ai-profile.schema.json`, "utf8"));
  return ajv.compile(schema);
}

function loadProfiles() {
  const dir = `${ROOT}/ai-profiles`;
  return readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .map((n) => ({ name: n, feature: n.replace(/\.json$/, ""), doc: JSON.parse(readFileSync(`${dir}/${n}`, "utf8")) }));
}

describe("V3-AIP-40 ai-profile.schema.json", () => {
  it("validates every ai-profiles/*.json against the schema", () => {
    const validate = compileProfile();
    for (const { name, doc } of loadProfiles()) {
      expect(validate(doc), `${name}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  it("has a profile for each of the 5 AI features (feature_id == filename)", () => {
    const byFeature = new Map(loadProfiles().map((p) => [p.feature, p]));
    for (const feature of AI_FEATURES) {
      const p = byFeature.get(feature);
      expect(p, `missing profile file for feature: ${feature}`).toBeDefined();
      expect(p!.doc.feature_id).toBe(feature);
    }
  });

  it("keeps every profile BYOK-only with no server-held key field", () => {
    for (const { name, doc } of loadProfiles()) {
      expect(doc.byok, `${name}: byok must be true (BYOK only)`).toBe(true);
      for (const field of SERVER_KEY_FIELDS) {
        expect(field in doc, `${name}: must not carry server key field '${field}'`).toBe(false);
      }
    }
  });

  it("uses only the frozen compute_tier enum (low/medium/high/max)", () => {
    for (const { name, doc } of loadProfiles()) {
      expect(["low", "medium", "high", "max"], `${name}: bad compute_tier`).toContain(doc.compute_tier);
    }
  });
});

describe("V3-AIP-104 BYOC compute_location (device-first, docker overflow, cloud opt-in)", () => {
  it("only allows the device/docker/cloud ladder when compute_location is set", () => {
    for (const { name, doc } of loadProfiles()) {
      if ("compute_location" in doc) {
        expect(["device", "docker", "cloud"], `${name}: bad compute_location`).toContain(doc.compute_location);
      }
    }
  });

  it("image-analysis declares its real execution location (cloud BYOK today)", () => {
    const doc = loadProfiles().find((p) => p.feature === "image-analysis")!.doc;
    expect(doc.compute_location).toBe("cloud");
  });
});
