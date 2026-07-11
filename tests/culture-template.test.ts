// V3-AIP-76 culture template versions + evaluation-axis schema (design-k8 §3).
// evaluation-axis.schema.json = 3 layers (common/purpose/custom). Template versions
// are append-only: appendTemplateVersion -> fork (forked_from) -> projectTemplateDiff
// -> projectTemplateRestore round-trips, and a duplicate version_id is a 409.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { TruthStore, ulid } from "@ihl/truth";
import {
  appendTemplateVersion,
  projectTemplateDiff,
  projectTemplateRestore,
  CULTURE_TEMPLATE_TYPE,
} from "../apps/api/src/culture";
import type { CultureTemplateData } from "../apps/api/src/culture";
import { FakeR2Bucket } from "./helpers";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(fileURLToPath(new URL("../package.json", import.meta.url)));
const Ajv2020 = require("ajv/dist/2020.js");
const ACTOR = "dev-actor";

function compileEvalAxis() {
  const ajv = new (Ajv2020.default ?? Ajv2020)({ allErrors: true, strict: false });
  const schema = JSON.parse(readFileSync(`${ROOT}/schemas/evaluation-axis.schema.json`, "utf8"));
  return ajv.compile(schema);
}

function makeVersion(overrides: Partial<CultureTemplateData> = {}): CultureTemplateData {
  return {
    template_id: "eval-axis-default",
    version_id: ulid(),
    kind: "eval_axis",
    body: { common: ["satisfaction", "reuse"], purpose: ["research"], custom: [] },
    author_actor_id: ACTOR,
    created_at: new Date().toISOString(),
    schema_version: "1",
    ...overrides,
  };
}

describe("V3-AIP-76 evaluation-axis.schema.json (3 layers)", () => {
  it("accepts a well-formed 3-layer axis body", () => {
    const validate = compileEvalAxis();
    const ok = validate({ common: ["satisfaction"], purpose: ["research"], custom: ["wild-genius"] });
    expect(ok, JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a body missing the custom layer", () => {
    const validate = compileEvalAxis();
    expect(validate({ common: [], purpose: [] })).toBe(false);
  });

  it("rejects a layer that is not a string array", () => {
    const validate = compileEvalAxis();
    expect(validate({ common: "satisfaction", purpose: [], custom: [] })).toBe(false);
  });
});

describe("V3-AIP-76 template versions (append / fork / diff / restore)", () => {
  it("append then fork then diff then restore round-trips", async () => {
    const s = new TruthStore(new FakeR2Bucket());

    const v1 = makeVersion();
    expect((await appendTemplateVersion(s, ACTOR, v1)).status).toBe("inserted");

    // fork: a new version with forked_from = v1 and a mutated custom layer.
    const v2 = makeVersion({
      version_id: ulid(),
      forked_from: v1.version_id,
      body: { common: ["satisfaction", "reuse"], purpose: ["research"], custom: ["wild-genius"] },
    });
    const forkRes = await appendTemplateVersion(s, ACTOR, v2);
    expect(forkRes.status).toBe("inserted");

    // stored fork carries the lineage pointer.
    const stored = await s.readEvent(`truth/${CULTURE_TEMPLATE_TYPE}/${v2.version_id}.json`);
    expect((stored?.data as CultureTemplateData).forked_from).toBe(v1.version_id);

    // diff surfaces exactly the changed key (custom).
    const diff = await projectTemplateDiff(s, v1.version_id, v2.version_id);
    expect(Object.keys(diff)).toEqual(["custom"]);
    expect(diff.custom).toEqual({ a: [], b: ["wild-genius"] });

    // restore round-trips: each version's body equals what was appended.
    expect(await projectTemplateRestore(s, v1.version_id)).toEqual(v1.body);
    expect(await projectTemplateRestore(s, v2.version_id)).toEqual(v2.body);
  });

  it("duplicate version_id append conflicts (put-if-absent 409, append-only)", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    const v = makeVersion();
    expect((await appendTemplateVersion(s, ACTOR, v)).status).toBe("inserted");
    // re-append same version_id with a different body -> rejected.
    const dup = { ...v, body: { common: [], purpose: [], custom: ["tampered"] } };
    expect((await appendTemplateVersion(s, ACTOR, dup)).status).toBe("conflict");
  });

  it("restore of an unknown version_id is null", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    expect(await projectTemplateRestore(s, ulid())).toBeNull();
  });
});
