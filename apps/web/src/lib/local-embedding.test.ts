import { describe, it, expect } from "vitest";
import { localHashEmbedding, cosineSimilarity } from "./local-embedding";

// V3-WIK-23: this only covers the placeholder hash-based pipeline (see the scope-limitation
// comment in local-embedding.ts) — NOT the real MiniLM/e5-small ONNX embedding, which is
// out of scope this round (package.json frozen, no onnxruntime-web dependency allowed).
describe("localHashEmbedding (V3-WIK-23 プレースホルダ)", () => {
  it("is deterministic for the same input", () => {
    const a = localHashEmbedding("カブトムシの標本");
    const b = localHashEmbedding("カブトムシの標本");
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("produces a unit-normalized vector for non-empty text", () => {
    const v = localHashEmbedding("hello world");
    let norm = 0;
    for (const x of v) norm += x * x;
    expect(Math.sqrt(norm)).toBeCloseTo(1, 5);
  });

  it("returns an all-zero vector for empty input", () => {
    const v = localHashEmbedding("");
    expect(Array.from(v).every((x) => x === 0)).toBe(true);
  });

  it("respects the requested dimension", () => {
    expect(localHashEmbedding("test", 32).length).toBe(32);
    expect(localHashEmbedding("test", 128).length).toBe(128);
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors", () => {
    const v = localHashEmbedding("同じ個体の観測メモ");
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it("is higher for similar text than for unrelated text", () => {
    const a = localHashEmbedding("カブトムシの角の長さを測定した");
    const b = localHashEmbedding("カブトムシの角を測定して記録した");
    const c = localHashEmbedding("今日の天気は晴れで気温が高い");
    expect(cosineSimilarity(a, b)).toBeGreaterThan(cosineSimilarity(a, c));
  });

  it("is 0 when either vector is all-zero", () => {
    const zero = localHashEmbedding("");
    const v = localHashEmbedding("something");
    expect(cosineSimilarity(zero, v)).toBe(0);
  });
});
