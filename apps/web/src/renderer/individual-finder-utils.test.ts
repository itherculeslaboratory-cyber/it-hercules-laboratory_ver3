import { describe, it, expect } from "vitest";
import {
  applyFinderSort,
  nextFinderSort,
  percentileThreshold,
  type FinderSort,
  type FinderSortRow,
} from "./individual-finder-utils";

describe("nextFinderSort — 列ヘッダクリックのソートパラメタ構築", () => {
  it("別の列をクリックしたら desc から始める", () => {
    const current: FinderSort = { key: "last_capture_at", dir: "asc" };
    expect(nextFinderSort(current, "latest_length_mm")).toEqual({ key: "latest_length_mm", dir: "desc" });
  });

  it("同じ列を再クリックしたら昇降トグル", () => {
    const desc: FinderSort = { key: "latest_length_mm", dir: "desc" };
    expect(nextFinderSort(desc, "latest_length_mm")).toEqual({ key: "latest_length_mm", dir: "asc" });
    const asc: FinderSort = { key: "latest_length_mm", dir: "asc" };
    expect(nextFinderSort(asc, "latest_length_mm")).toEqual({ key: "latest_length_mm", dir: "desc" });
  });
});

type Row = FinderSortRow & { individual_id: string };
const row = (id: string, latest_length_mm: number | null): Row => ({
  individual_id: id,
  latest_length_mm,
  latest_weight_g: null,
  capture_count: 0,
  last_capture_at: null,
  next_observation_at: null,
});

describe("applyFinderSort — 決定論sort", () => {
  it("desc は大きい順、null は常に末尾", () => {
    const rows = [row("c", null), row("a", 30), row("b", 50)];
    const sorted = applyFinderSort(rows, { key: "latest_length_mm", dir: "desc" });
    expect(sorted.map((r) => r.individual_id)).toEqual(["b", "a", "c"]);
  });

  it("asc は小さい順、null は常に末尾(方向によらず)", () => {
    const rows = [row("c", null), row("a", 30), row("b", 50)];
    const sorted = applyFinderSort(rows, { key: "latest_length_mm", dir: "asc" });
    expect(sorted.map((r) => r.individual_id)).toEqual(["a", "b", "c"]);
  });

  it("同値は individual_id 昇順でタイブレーク", () => {
    const rows = [row("z", 10), row("a", 10)];
    const sorted = applyFinderSort(rows, { key: "latest_length_mm", dir: "desc" });
    expect(sorted.map((r) => r.individual_id)).toEqual(["a", "z"]);
  });
});

describe("percentileThreshold — 実データ分位点(プリセット用)", () => {
  it("既知の分布で90パーセンタイルを線形補間で計算する", () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    // idx = 0.9 * 9 = 8.1 -> xs[8]=90, xs[9]=100 -> 90 + 0.1*10 = 91
    expect(percentileThreshold(values, 90)).toBeCloseTo(91);
  });

  it("null/undefined/NaN は無視する", () => {
    const values = [10, null, undefined, Number.NaN, 20];
    expect(percentileThreshold(values, 50)).toBeCloseTo(15);
  });

  it("値0件は null(ハードコード閾値へフォールバックしない)", () => {
    expect(percentileThreshold([], 90)).toBeNull();
  });

  it("値1件はその値そのもの", () => {
    expect(percentileThreshold([42], 90)).toBe(42);
  });
});
