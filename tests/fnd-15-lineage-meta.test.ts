// V3-FND-15: computeLineageMeta produces deterministic, schema-valid lineage
// metadata. The generated lineage-meta validator (via validateFrozen by name)
// is the wiring guard — meta that fails it must never be accepted.
import { describe, expect, it } from "vitest";
import { computeLineageMeta, validateFrozen } from "@ihl/truth";

const HEX64 = /^[0-9a-f]{64}$/;

describe("FND-15 lineage meta", () => {
  it("generates a validator-green root meta; rejects missing hash and null fields", async () => {
    const meta = await computeLineageMeta({ b: 2, a: 1 });
    expect(validateFrozen("lineage-meta", meta).valid).toBe(true);
    expect(meta.generation).toBe(0);
    expect(HEX64.test(meta.content_hash)).toBe(true);
    expect(HEX64.test(meta.lineage_hash)).toBe(true);
    // root omits value-absent fields (no null/empty per AI-first rule).
    expect("parent_uuid" in meta).toBe(false);
    expect("ancestor_chain" in meta).toBe(false);

    const { lineage_hash: _drop, ...noLineage } = meta;
    expect(validateFrozen("lineage-meta", noLineage).valid).toBe(false);
    expect(validateFrozen("lineage-meta", { ...meta, content_hash: null }).valid).toBe(
      false,
    );
  });

  it("is deterministic: same content yields the same content and lineage hashes", async () => {
    const a = await computeLineageMeta({ x: 1, y: [3, 2] });
    const b = await computeLineageMeta({ y: [3, 2], x: 1 });
    expect(a.content_hash).toBe(b.content_hash);
    expect(a.lineage_hash).toBe(b.lineage_hash);
  });

  it("chains a child: ancestor_chain includes parent uuid, generation increments, lineage depends on parent", async () => {
    const parent = await computeLineageMeta({ v: 1 });
    const child = await computeLineageMeta({ v: 2 }, parent);
    const orphan = await computeLineageMeta({ v: 2 });

    expect(child.generation).toBe(parent.generation + 1);
    expect(child.parent_uuid).toBe(parent.uuid);
    expect(child.ancestor_chain).toEqual([parent.uuid]);
    // same content, but the child's lineage_hash is parent-dependent.
    expect(child.content_hash).toBe(orphan.content_hash);
    expect(child.lineage_hash).not.toBe(orphan.lineage_hash);
    expect(validateFrozen("lineage-meta", child).valid).toBe(true);
  });
});
