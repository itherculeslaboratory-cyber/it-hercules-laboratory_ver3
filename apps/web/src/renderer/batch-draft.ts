// C7 スライス2 (V3-AIP-101 §F4/F5/F6 まとめて記録バッチ)。F4 で組み立てた保存
// 予定行を F5b(確認)→F6b(完了)へ運ぶための sessionStorage キャリー。
// 単発の draft.ts(F2→F5 の 1 件 body+file)と同じ「下書き」思想だが、バッチは
// 複数行+種別ごとの表示情報を運ぶ必要があるため別モジュールにした(単発と
// 形が違いすぎる二重化より、別の小さいモジュールの方が単純)。全 group
// (昇格を含む)は同じく items[] に積まれ確認画面の一括保存まで未コミット。

const KEY = "ihl:batch-draft";
const RESULTS_KEY = "ihl:batch-results";
const PRESELECT_KEY = "ihl:batch-preselect";

export type BatchGroup = "measure" | "move" | "death" | "stage" | "clutch-reconcile" | "clutch-promote";

// items[] entries — the EXACT shape POST /api/v1/observation/batch-commit
// expects (kind/body/individual_id/clutch_id/subject_ref/to_placement_id/at).
export type BatchCommitItem = Record<string, unknown>;

export type DraftRow = {
  key: string;
  group: BatchGroup;
  label: string; // 表示ラベル(個体ラベル/クラッチラベル・生ULIDは出さない)
  valueText?: string;
  deltaText?: string;
  attention?: boolean; // Δマイナス等・F5b の「この行だけ見てください」
  itemIndex?: number; // items[] 内のインデックス(全 group が items[] を持つ — 昇格も他と同じく確認保存まで遅延)
};

export type ScheduleTarget = { individual_id: string; label: string };

export type BatchDraft = {
  items: BatchCommitItem[];
  rows: DraftRow[];
  scheduleTargets: ScheduleTarget[];
};

export type BatchResult = { ok: true; id: string } | { ok: false; error: string };
export type BatchResults = { results: BatchResult[]; scheduledAt?: string };

function store(): Storage | null {
  return typeof window !== "undefined" ? window.sessionStorage : null;
}

export function saveBatchDraft(draft: BatchDraft): void {
  store()?.setItem(KEY, JSON.stringify(draft));
}

export function loadBatchDraft(): BatchDraft | null {
  const raw = store()?.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BatchDraft;
  } catch {
    return null;
  }
}

export function saveBatchResults(results: BatchResults): void {
  store()?.setItem(RESULTS_KEY, JSON.stringify(results));
}

export function loadBatchResults(): BatchResults | null {
  const raw = store()?.getItem(RESULTS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BatchResults;
  } catch {
    return null;
  }
}

export function clearBatch(): void {
  store()?.removeItem(KEY);
  store()?.removeItem(RESULTS_KEY);
}

// 検索スライスA(obs-search): バスケットの個体IDだけを運ぶ小さい別キャリー。
// BatchDraft(items/rows=確定済みコミット内容)とは形が違いすぎる(こちらは
// 「まだ何も組み立てていない、チェックだけ引き継ぎたい」プリセレクト)ので
// 使い回さず、専用の小さいキー1本にした。読んだら消費(1回きりの引き継ぎ)。
export function savePreselect(ids: string[]): void {
  store()?.setItem(PRESELECT_KEY, JSON.stringify(ids));
}

export function loadPreselect(): string[] | null {
  const raw = store()?.getItem(PRESELECT_KEY);
  if (!raw) return null;
  store()?.removeItem(PRESELECT_KEY); // consume — one-shot handoff
  try {
    const ids = JSON.parse(raw) as unknown;
    return Array.isArray(ids) ? ids.filter((v): v is string => typeof v === "string") : null;
  } catch {
    return null;
  }
}
