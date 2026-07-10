// CL-08: embedding 契約 (dim=384・L2 正規化) —
// schemas/frozen/embedding-manifest.schema.json + scoring.py 次元ガード移植。
// model_name に const は無い(CI 'dummy' 許容が凍結時の判断)ため、
// 「非 dinov2 拒否」はスキーマでは表現できない — openIssues で明示。
import { describe, expect, it } from "vitest";
import { cosineSimilarity, validateFrozen } from "@ihl/truth";
import { loadFixture } from "./helpers";

const sample = loadFixture("cl-shape-samples.json")["cl-08"] as Record<
  string,
  unknown
>;

describe("CL-08 embedding manifest shape", () => {
  it("accepts the real ver2 sample", () => {
    expect(validateFrozen("embedding-manifest", sample).valid).toBe(true);
  });

  it.each([768, 383, 1536])("rejects embedding_dim = %d (const 384)", (dim) => {
    const bad = { ...sample, embedding_dim: dim };
    expect(validateFrozen("embedding-manifest", bad).valid).toBe(false);
  });

  it("rejects non-L2 (normalized_flag !== true, const)", () => {
    const bad = { ...sample, normalized_flag: false };
    expect(validateFrozen("embedding-manifest", bad).valid).toBe(false);
  });

  it("rejects a manifest missing model_name (required)", () => {
    const bad = { ...sample };
    delete bad.model_name;
    expect(validateFrozen("embedding-manifest", bad).valid).toBe(false);
  });

  it("rejects a non-string model_name", () => {
    const bad = { ...sample, model_name: 42 };
    expect(validateFrozen("embedding-manifest", bad).valid).toBe(false);
  });
});

describe("CL-08 dim guard (scoring.py port)", () => {
  it("throws 'Embedding dim mismatch' when vector dims differ", () => {
    const a = new Float32Array(384).fill(0.1);
    const b = new Float32Array(383).fill(0.1);
    expect(() => cosineSimilarity(a, b)).toThrow(/Embedding dim mismatch/);
  });

  it("returns 1 for an identical L2-normalized vector (clamped to [-1,1])", () => {
    const a = new Float32Array(384);
    a[0] = 1; // unit vector
    expect(cosineSimilarity(a, a)).toBe(1);
    const neg = new Float32Array(384);
    neg[0] = -1;
    expect(cosineSimilarity(a, neg)).toBe(-1);
  });
});
