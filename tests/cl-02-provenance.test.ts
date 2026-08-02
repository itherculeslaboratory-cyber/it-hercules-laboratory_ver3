// CL-02: Truth provenance メタ (run_id / schema_version / input_hash / value_origin)
// — schemas/frozen/provenance.schema.json が担保先。
import { describe, expect, it } from "vitest";
import { validateEnvelope, validateFrozen } from "@ihl/truth";
import app from "../apps/api/src/index";
import { AUTH_HEADERS, loadFixture, makeEnv, makeEnvelope } from "./helpers";

const sample = loadFixture("cl-shape-samples.json")["cl-02"] as Record<
  string,
  unknown
>;
const DATASCHEMA = "schemas/frozen/provenance.schema.json";

describe("CL-02 provenance meta", () => {
  it("accepts the real ver2 sample", () => {
    expect(validateFrozen("provenance", sample).valid).toBe(true);
  });

  it.each(["run_id", "schema_version", "input_hash", "created_at"])(
    "rejects a record missing required %s",
    (field) => {
      const bad = { ...sample };
      delete bad[field];
      expect(validateFrozen("provenance", bad).valid).toBe(false);
    },
  );

  it("rejects value_origin outside the frozen enum", () => {
    const bad = { ...sample, value_origin: "guessed" };
    expect(validateFrozen("provenance", bad).valid).toBe(false);
  });

  it("rejects unknown extra properties (additionalProperties: false)", () => {
    const bad = { ...sample, freeform_note: "x" };
    expect(validateFrozen("provenance", bad).valid).toBe(false);
  });

  it("validates envelope data against the frozen schema via dataschema", () => {
    const good = makeEnvelope({ dataschema: DATASCHEMA, data: sample });
    expect(validateEnvelope(good).valid).toBe(true);

    const badData = { ...sample };
    delete badData.run_id;
    const bad = makeEnvelope({ dataschema: DATASCHEMA, data: badData });
    expect(validateEnvelope(bad).valid).toBe(false);
  });

  it("rejects an envelope missing its own provenance extension", () => {
    const bad = makeEnvelope();
    delete (bad as Record<string, unknown>).provenance;
    expect(validateEnvelope(bad).valid).toBe(false);
  });

  // g93 裁定②(00-hq\kits\lane-think\R0802-709a2e-REPORT-2026-08-02-prep-truthruling2.md R2)。
  // 趣旨は不変 =「壊れた provenance を載せた envelope は POST /events で受理されない」。
  // 変わったのは拒否する層とコード: 以前は putEvent まで到達して 400 INVALID_ENVELOPE
  // だったが、T5 の dataschema ポジティブリスト(apps/api/src/index.ts:691-711)により
  // frozen/provenance は self-service のどの type にも許可されておらず、putEvent へ
  // 到達する前に 403 DATASCHEMA_NOT_ALLOWED で弾かれる。
  // ★これは緩和ではなく強化 — T5 以前は「正しい形の provenance data」なら 201 で通っていた。
  // 400 INVALID_ENVELOPE の層レベルの意味論は tests/f2-research-query-truth.test.ts:61-70 が、
  // provenance 固有の data 検証は上の validateEnvelope 直呼びが引き続き守る。
  it("POST /events with a frozen provenance dataschema → 403 (rejected before putEvent)", async () => {
    const badData = { ...sample };
    delete badData.run_id;
    const res = await app.request(
      "/events",
      {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify(
          makeEnvelope({ dataschema: DATASCHEMA, data: badData }),
        ),
      },
      makeEnv(),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("DATASCHEMA_NOT_ALLOWED");
  });
});
