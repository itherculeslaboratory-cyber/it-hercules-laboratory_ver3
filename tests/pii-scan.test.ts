// V3-SEC-07 (design §3, pii.test case 6, split out here to keep pii.mjs consumers
// file-disjoint). pii-scan batch: masks a corpus into <outDir>/masked/, emits
// pii-candidates.json + pii-diff.json, and leaves the source originals untouched.
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runScan } from "../scripts/pii-scan.mjs";

const work = mkdtempSync(join(tmpdir(), "pii-scan-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe("V3-SEC-07 pii-scan batch", () => {
  it("masks copies, emits candidates + diff, and leaves the source unchanged", () => {
    const srcDir = join(work, "src");
    const outDir = join(work, "out");
    mkdirSync(join(srcDir, "sub"), { recursive: true });
    const original = "連絡は bob@example.com、電話 090-1234-5678";
    writeFileSync(join(srcDir, "sub", "note.txt"), original);
    writeFileSync(join(srcDir, "clean.txt"), "no pii here");

    const { candidates, diffs } = runScan(srcDir, outDir);

    // masked copy has placeholders, not the raw PII.
    const masked = readFileSync(join(outDir, "masked", "sub", "note.txt"), "utf8");
    expect(masked).toContain("{{PII:EMAIL}}");
    expect(masked).toContain("{{PII:PHONE_JP}}");
    expect(masked).not.toContain("bob@example.com");
    expect(masked).not.toContain("090-1234-5678");

    // candidates list only the file that had PII.
    const candidatesFile = JSON.parse(readFileSync(join(outDir, "pii-candidates.json"), "utf8"));
    expect(candidatesFile).toEqual(candidates);
    expect(candidatesFile.map((c: { file: string }) => c.file)).toEqual(["sub/note.txt"]);
    expect(candidatesFile[0].count).toBe(2);

    // diff records the masked spans.
    const diffFile = JSON.parse(readFileSync(join(outDir, "pii-diff.json"), "utf8"));
    expect(diffFile).toEqual(diffs);
    expect(diffFile[0].spans.length).toBe(2);

    // source original is untouched (原本隔離).
    expect(readFileSync(join(srcDir, "sub", "note.txt"), "utf8")).toBe(original);
  });
});
