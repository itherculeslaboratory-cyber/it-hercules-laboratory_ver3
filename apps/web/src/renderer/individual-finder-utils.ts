// T-63 波1(design-individual-finder.md §2.3/§4): 個体ファインダー一覧面の純関数。
// 実データ配線は apps/web/public/finder/lib/finder-data.js(caseB7実物)側 — ここに
// 切り出したのはユニットテストで rendering 抜きに検算するため(既存 i18n.ts/i18n.test.ts と同じ切り出し方)。

// バックエンドの sort ホワイトリスト(individual-routes.ts LIST_SORT_FIELDS)と
// 同じ5値。個体一覧はここに無い項目ではソートしない(決定論を崩さない)。
export const FINDER_SORT_FIELDS = [
  "latest_length_mm",
  "latest_weight_g",
  "capture_count",
  "last_capture_at",
  "next_observation_at",
] as const;
export type FinderSortKey = (typeof FINDER_SORT_FIELDS)[number];
export type FinderSortDir = "asc" | "desc";
export interface FinderSort {
  key: FinderSortKey;
  dir: FinderSortDir;
}

/** 列ヘッダクリックのソートパラメタ構築: 同じ列を再クリックしたら昇降トグル、
 * 別の列なら desc(大きい/新しい順)から始める。 */
export function nextFinderSort(current: FinderSort, clickedKey: FinderSortKey): FinderSort {
  if (current.key === clickedKey) {
    return { key: clickedKey, dir: current.dir === "desc" ? "asc" : "desc" };
  }
  return { key: clickedKey, dir: "desc" };
}

export type FinderSortRow = Record<FinderSortKey, number | string | null>;

function sortValue(row: FinderSortRow, key: FinderSortKey): number | null {
  const v = row[key];
  if (typeof v === "number") return v;
  if (typeof v === "string" && v) return new Date(v).getTime();
  return null;
}

/** 決定論sort: null は方向によらず常に末尾、同値は individual_id 昇順(既存
 * listIndividualsFor と同じ tie-break)。 */
export function applyFinderSort<T extends FinderSortRow & { individual_id: string }>(
  rows: T[],
  sort: FinderSort,
): T[] {
  const mul = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = sortValue(a, sort.key);
    const bv = sortValue(b, sort.key);
    if (av == null && bv == null) return a.individual_id.localeCompare(b.individual_id);
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av === bv) return a.individual_id.localeCompare(b.individual_id);
    return av < bv ? -mul : mul;
  });
}

/** p 分位点(0-100、線形補間)。実データの値配列から都度計算する — ハードコード
 * 閾値は使わない(design-individual-finder.md §2.3)。null/NaN は無視、値0件はnull。 */
export function percentileThreshold(values: (number | null | undefined)[], p: number): number | null {
  const xs = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0];
  const idx = (p / 100) * (xs.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return xs[lo];
  return xs[lo] + (xs[hi] - xs[lo]) * (idx - lo);
}
