// CL-05: 利用規約同意記録 — schemas/frozen/consent-record.schema.json +
// append-only(複数同意=別ファイル)振る舞い。
import { describe, expect, it } from "vitest";
import { TruthStore, validateFrozen } from "@ihl/truth";
import { FakeR2Bucket, loadFixture, makeEnvelope } from "./helpers";

const sample = loadFixture("cl-shape-samples.json")["cl-05"] as Record<
  string,
  unknown
>;
const DATASCHEMA = "schemas/frozen/consent-record.schema.json";

describe("CL-05 consent record shape", () => {
  it("accepts the real ver2 legal_agree_v1 sample", () => {
    expect(validateFrozen("consent-record", sample).valid).toBe(true);
  });

  it("rejects an agree_id that does not match agree_<12 hex>", () => {
    const bad = { ...sample, agree_id: "agree_XYZ" };
    expect(validateFrozen("consent-record", bad).valid).toBe(false);
  });

  it("rejects a wrong schema const", () => {
    const bad = { ...sample, schema: "legal_agree_v2" };
    expect(validateFrozen("consent-record", bad).valid).toBe(false);
  });

  it.each(["actor_id", "terms_version", "is_draft_terms", "legal_gate"])(
    "rejects a record missing required %s",
    (field) => {
      const bad = { ...sample };
      delete bad[field];
      expect(validateFrozen("consent-record", bad).valid).toBe(false);
    },
  );

  it("rejects unknown extra properties", () => {
    const bad = { ...sample, signature: "x" };
    expect(validateFrozen("consent-record", bad).valid).toBe(false);
  });
});

describe("CL-05 consent append-only behaviour", () => {
  it("re-put of the same consent key is rejected; a new consent = new file", async () => {
    const store = new TruthStore(new FakeR2Bucket());
    const consent = makeEnvelope({
      type: "ihl.legal.agree.v1",
      dataschema: DATASCHEMA,
      data: sample,
    });

    expect((await store.putEvent(consent)).status).toBe("inserted");
    // same key again → rejected (no overwrite of a legal record, ever)
    expect((await store.putEvent(consent)).status).toBe("conflict");

    // a NEW consent event (new id → new agree file) is appended fine
    const again = makeEnvelope({
      type: "ihl.legal.agree.v1",
      dataschema: DATASCHEMA,
      data: { ...sample, agree_id: "agree_0123456789ab" },
    });
    expect((await store.putEvent(again)).status).toBe("inserted");
  });
});
