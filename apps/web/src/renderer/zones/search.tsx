"use client";

import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import ResearchPanel from "@/research/ResearchPanel";
import { fetchManifestLatest, fetchManifestParquet, type ManifestLatestInfo } from "@/research/manifest-client";
import { loadDuckDb, registerManifest, runResearchQuery } from "@/research/duckdb-client";
import { saveResearchQueryToTruth } from "@/research/truth-query-save";
import type { ResearchQueryJson } from "@/research/query-generator";
import { GraphView, type GraphViewIndividual, type PedigreeLink } from "../graph-view/GraphView";
import { savePreselect } from "../batch-draft";

import { ExecuteCtx, HeaderScopeCtx, MessagesCtx, NavigateCtx, ScopeCtx } from "../core/context";
import { errorText, headerScopeQuery, STAGE_LABELS_JA, safeLabel, type PlacementRow } from "../core/scope";
import { registerNode } from "../core/registry";
import { Badge } from "../core/primitives";

// =============================================================================
// V3-AIP-101 検索スライスA(obs-search・c7-wireframes-core5 §2 のトーン/語彙
// のみ流用: F3類似度検索/ステージ別グルーピング/F1L軽量グリッド/コールド
// スタート自動プリセットは対象外)。GET /individuals(拡張フィールド込み)+
// GET /placements を1回ずつ取得し、保存検索チップ(localStorage)+ファセット
// 絞り込み+0件緩和バー+4択ソート+下部固定バスケットをこのノード1個で完結
// させる(batch-roster と同じ縮退理由: 複数API呼び出し+行単位ローカル状態が
// 多く、既存の宣言的語彙では表現しきれない)。
// =============================================================================

// T2(E1横断検索UI導線): GET /api/v1/search(apps/api/src/cross-search-routes.ts・
// R0801-d5e912実装済み)のレスポンス型。API契約をそのまま写す(創作しない)。
type CrossSearchResultRow = {
  event_id: string;
  type: string;
  subject: string | null;
  actor_id: string | null;
  received_at: string;
  payload_key: string;
  text_repr: string | null;
};
type CrossSearchResponse = {
  query: { q: string | null; type: string | null; subject: string | null; actor_id: string | null; from: string; to: string };
  count: number;
  results: CrossSearchResultRow[];
  truncated: boolean;
  truncated_dates: string[];
  unknown_type_note: string;
  dedup_note: string;
};

type SearchRow = {
  individual_id: string;
  label: string;
  species: string | null;
  stage: string | null;
  placement_id: string | null;
  last_care_at: string | null;
  latest_weight_g: number | null;
  latest_length_mm: number | null;
  capture_count: number;
  eclosion_at: string | null;
  thumbnail_path: string | null;
};

// T-A3(V3-UIX-40残り「色検索」・g90-w2search): GET /api/v1/individuals?color_hex=
// (R0802実装。individual-routes.ts listIndividualsFor)のレスポンス行。通常の
// SearchRow に color_distance(ΔE76・小さいほど近い)が1個増えるだけ。
type ColorSearchRow = SearchRow & { color_distance: number };
type ColorSearchResponse = {
  individuals: ColorSearchRow[];
  color_search: { excluded_no_color: number; max_delta: number };
};

// V3-UIX-37是正(uib05A・R0801-95b347=UIB05A-1○85点「このほうが綺麗」): 数値フィルタの
// 操作方式を「中心値±幅」固定から「以上/以下/付近」の常時表示クリック選択に変更。
// mode="near" の時だけ従来の中心値±幅(lengthCenter/lengthWidth)を使う。
// mode="gte"/"lte" の時は単一値(lengthValue)を使う。3モードとも上限キャップなし・自由入力・0件可。
type NumericFilterMode = "gte" | "lte" | "near";

type SearchFilters = {
  species: string | null;
  stage: string | null;
  shelf: string | null;
  lengthMode: NumericFilterMode;
  lengthValue: number | null;
  lengthCenter: number | null;
  lengthWidth: number | null;
  weightMode: NumericFilterMode;
  weightValue: number | null;
  weightCenter: number | null;
  weightWidth: number | null;
};

const DEFAULT_SEARCH_FILTERS: SearchFilters = {
  species: null,
  stage: null,
  shelf: null,
  lengthMode: "near",
  lengthValue: null,
  lengthCenter: null,
  lengthWidth: null,
  weightMode: "near",
  weightValue: null,
  weightCenter: null,
  weightWidth: null,
};

type SearchSort = "length_desc" | "weight_desc" | "last_capture_desc" | "eclosion_desc";
const DEFAULT_SEARCH_SORT: SearchSort = "last_capture_desc";
const SEARCH_SORT_LABELS: Record<SearchSort, string> = {
  length_desc: "体長↓",
  weight_desc: "体重↓",
  last_capture_desc: "最終観測日",
  eclosion_desc: "羽化日(新しい順)",
};

// 直近使った条件(フィルタ+ソート)の自動復元キー。
const SEARCH_LAST_KEY = "ihl:obs-search-last-filter";
// 保存検索チップ。Truth 保存の是非は c7-wireframes-core5.md の open_questions
// (~L899-903)がまだ裁定待ちのため、意図的に localStorage だけに留める
// (裁定後の後続波で Truth 化を検討)。
const SEARCH_SAVED_KEY = "ihl:obs-search-saved";

type SavedSearch = { id: string; name: string; filters: SearchFilters; sort: SearchSort };

function loadLastFilter(): { filters: SearchFilters; sort: SearchSort } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SEARCH_LAST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { filters?: Partial<SearchFilters>; sort?: SearchSort };
    return {
      filters: { ...DEFAULT_SEARCH_FILTERS, ...(parsed.filters ?? {}) },
      sort: parsed.sort && parsed.sort in SEARCH_SORT_LABELS ? parsed.sort : DEFAULT_SEARCH_SORT,
    };
  } catch {
    return null;
  }
}
function saveLastFilter(filters: SearchFilters, sort: SearchSort): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SEARCH_LAST_KEY, JSON.stringify({ filters, sort }));
  } catch {
    /* best effort */
  }
}
function loadSavedSearches(): SavedSearch[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SEARCH_SAVED_KEY);
    const rows = raw ? (JSON.parse(raw) as SavedSearch[]) : [];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}
function persistSavedSearches(rows: SavedSearch[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SEARCH_SAVED_KEY, JSON.stringify(rows));
  } catch {
    /* best effort */
  }
}
function filtersEqual(a: SearchFilters, b: SearchFilters): boolean {
  return (
    a.species === b.species &&
    a.stage === b.stage &&
    a.shelf === b.shelf &&
    a.lengthMode === b.lengthMode &&
    a.lengthValue === b.lengthValue &&
    a.lengthCenter === b.lengthCenter &&
    a.lengthWidth === b.lengthWidth &&
    a.weightMode === b.weightMode &&
    a.weightValue === b.weightValue &&
    a.weightCenter === b.weightCenter &&
    a.weightWidth === b.weightWidth
  );
}
// mode="gte"/"lte": 単一値との比較(値未入力なら絞らない)。
// mode="near": 中心値・幅の両方が揃って初めてレンジが有効(片方だけでは絞らない —
// 小数の完全一致で誤って0件化するのを避ける・従来ロジックを維持)。
function matchesNumericFilter(
  value: number | null,
  mode: NumericFilterMode,
  filterValue: number | null,
  center: number | null,
  width: number | null,
): boolean {
  if (mode === "gte") {
    if (filterValue == null) return true;
    return value != null && value >= filterValue;
  }
  if (mode === "lte") {
    if (filterValue == null) return true;
    return value != null && value <= filterValue;
  }
  if (center == null || width == null) return true;
  return value != null && Math.abs(value - center) <= width;
}
function matchesFilters(row: SearchRow, f: SearchFilters): boolean {
  if (f.species != null && row.species !== f.species) return false;
  if (f.stage != null && row.stage !== f.stage) return false;
  if (f.shelf != null && row.placement_id !== f.shelf) return false;
  if (!matchesNumericFilter(row.latest_length_mm, f.lengthMode, f.lengthValue, f.lengthCenter, f.lengthWidth))
    return false;
  if (!matchesNumericFilter(row.latest_weight_g, f.weightMode, f.weightValue, f.weightCenter, f.weightWidth))
    return false;
  return true;
}
function facetCount(rows: SearchRow[], filters: SearchFilters, key: "species" | "stage" | "shelf", value: string): number {
  return rows.filter((r) => matchesFilters(r, { ...filters, [key]: value })).length;
}
function sortValue(row: SearchRow, sort: SearchSort): number | null {
  if (sort === "length_desc") return row.latest_length_mm;
  if (sort === "weight_desc") return row.latest_weight_g;
  const iso = sort === "eclosion_desc" ? row.eclosion_at : row.last_care_at;
  return iso ? new Date(iso).getTime() : null;
}
function sortRows(rows: SearchRow[], sort: SearchSort): SearchRow[] {
  return [...rows].sort((a, b) => {
    const av = sortValue(a, sort);
    const bv = sortValue(b, sort);
    if (av == null && bv == null) return 0;
    if (av == null) return 1; // null は末尾
    if (bv == null) return -1;
    return bv - av; // 降順
  });
}

// V3-OBS-02 観測対象ナビゲータ: 学名検索(substring) / アキネーター式yes-no
// 二分探索 / 分類ツリー の3経路を1ノードに持つ(POST /observation/targets/search
// の mode:"name"|"yesno"|"tree" 3モードを叩く — テキストのみ、画像/サムネイル
// は出さない・design-c2 §3.2)。3経路とも「候補提示」止まりで、確定は末尾の
// [この対象で観測を続ける] ボタン(navigate)がユーザー操作として行う — AI/API
// 側は species_confirmed を一切書かない(候補提示と確定の分離)。選んだ学名は
// obs-entry へ species_candidate として引き継ぐ(obs-entry の species_candidate
// フィールドはユーザー編集可のプレフィルなので、確定は commit 側で改めて起きる)。
export type TargetCandidate = { qid: string; scientific_name: string };

// HDR-1(c9-structure-canon.md §1b/§1c・R112/R115)ヘッダー観測対象セレクタ:
// obs-navigator画面の既定(確定→obs-entryへnavigate)と、ヘッダーの既定
// (確定→アプリ全体スコープの選好保存)は同じUI部品(target-navigator)を使う
// が別概念(§1b名称衝突注記)。onConfirm を渡すと確定アクションが丸ごと
// 差し替わる(navigate は一切呼ばれない) — obs-navigator画面側の呼び出しは
// props無しのまま(挙動無変更)。confirmLabel は文言の書き分け用
// (「今この対象を見ています」= ヘッダー / 「この記録の対象種を選ぶ」= 画面)。
//
// 構造要約(c8 UI磨きR0801-9d452f-ui13rendererdoc・screen-defs/obs-navigator.json
// はnode {type:"target-navigator"} 1個のみでこのコンポーネントに委譲。動作影響なし):
//   3経路タブ(学名検索/yes-no二分探索/分類ツリーdrill-down)→ いずれかで
//   候補を絞り込み → 候補カード確定ボタン1つ(捏造防止=AIは書かない・候補提示のみ)。
//   状態: タブ選択+各経路のローカル状態(検索文字列/yes-no累積回答/ツリーpath)+候補一覧。
function TargetNavigatorNode({
  onConfirm,
  confirmLabel,
}: { onConfirm?: (candidate: TargetCandidate) => void; confirmLabel?: string } = {}) {
  const execute = useContext(ExecuteCtx);
  const navigate = useContext(NavigateCtx);

  // 選ばれた対象(3経路のどれで決まってもここに集約)。
  const [chosen, setChosen] = useState<TargetCandidate | null>(null);

  // 経路1: 学名検索。
  const [nameQuery, setNameQuery] = useState("");
  const [nameCandidates, setNameCandidates] = useState<TargetCandidate[]>([]);
  const [namePending, setNamePending] = useState(false);
  const searchByName = useCallback(async () => {
    if (!nameQuery.trim()) return;
    setNamePending(true);
    try {
      const r = (await execute({ kind: "api", method: "POST", path: "/api/v1/observation/targets/search" }, {
        mode: "name",
        query: nameQuery,
      })) as { candidates?: TargetCandidate[] } | undefined;
      setNameCandidates(r?.candidates ?? []);
    } finally {
      setNamePending(false);
    }
  }, [execute, nameQuery]);

  // 経路2: はい・いいえ二分探索(サーバは状態を持たない — クライアントが
  // 回答列を毎回まるごと再送する、targets.test.ts と同じステートレス方式)。
  const [started, setStarted] = useState(false);
  const [answers, setAnswers] = useState<boolean[]>([]);
  const [question, setQuestion] = useState<{ pivot: string; remaining: number } | null>(null);
  const [yesnoResolved, setYesnoResolved] = useState<TargetCandidate | null>(null);
  const [yesnoAsked, setYesnoAsked] = useState(0);
  const askYesNo = useCallback(
    async (nextAnswers: boolean[]) => {
      const r = (await execute({ kind: "api", method: "POST", path: "/api/v1/observation/targets/search" }, {
        mode: "yesno",
        answers: nextAnswers,
      })) as { resolved?: { qid: string; taxonomy: { species?: string } } | null; questions_asked?: number; question?: { pivot: string; remaining: number } } | undefined;
      setAnswers(nextAnswers);
      if (r?.resolved) {
        setYesnoResolved({ qid: r.resolved.qid, scientific_name: String(r.resolved.taxonomy?.species ?? r.resolved.qid) });
        setQuestion(null);
        setYesnoAsked(r.questions_asked ?? nextAnswers.length);
      } else {
        setQuestion(r?.question ?? null);
        setYesnoResolved(null);
      }
    },
    [execute],
  );
  const startYesNo = useCallback(() => {
    setStarted(true);
    setYesnoResolved(null);
    void askYesNo([]);
  }, [askYesNo]);
  const answer = useCallback((yes: boolean) => void askYesNo([...answers, yes]), [answers, askYesNo]);

  // 経路3: 分類ツリー(family → genus → species)。
  const [treePath, setTreePath] = useState<string[]>([]);
  const [treeChildren, setTreeChildren] = useState<string[]>([]);
  const [treeResolved, setTreeResolved] = useState<TargetCandidate | null>(null);
  const loadTreeLevel = useCallback(
    async (path: string[]) => {
      const r = (await execute({ kind: "api", method: "POST", path: "/api/v1/observation/targets/search" }, {
        mode: "tree",
        path,
      })) as { children?: string[]; resolved?: { qid: string; taxonomy: { species?: string } } } | undefined;
      setTreePath(path);
      if (r?.resolved) {
        setTreeResolved({ qid: r.resolved.qid, scientific_name: String(r.resolved.taxonomy?.species ?? r.resolved.qid) });
        setTreeChildren([]);
      } else {
        setTreeResolved(null);
        setTreeChildren(r?.children ?? []);
      }
    },
    [execute],
  );
  useEffect(() => {
    void loadTreeLevel([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const continueTo = useCallback(() => {
    if (!chosen) return;
    if (onConfirm) {
      onConfirm(chosen);
      return;
    }
    navigate("obs-entry", { species_candidate: chosen.scientific_name });
  }, [chosen, navigate, onConfirm]);

  return (
    <div className="civ-target-navigator">
      <h2 className="civ-heading">学名で探す</h2>
      <div className="civ-field">
        <input
          className="civ-input"
          value={nameQuery}
          onChange={(e) => setNameQuery(e.target.value)}
          placeholder="例: Dynastes"
          aria-label="学名の一部"
        />
        <button
          type="button"
          className={cn("civ-interactive", "civ-button")}
          data-variant="secondary"
          aria-busy={namePending || undefined}
          onClick={() => void searchByName()}
        >
          候補を探す
        </button>
      </div>
      {nameCandidates.length > 0 && (
        <ul className="civ-list">
          {nameCandidates.map((c) => (
            <li key={c.qid}>
              <button
                type="button"
                className={cn("civ-interactive", "civ-button")}
                data-variant={chosen?.qid === c.qid ? "primary" : "ghost"}
                onClick={() => setChosen(c)}
              >
                {c.scientific_name}
              </button>
            </li>
          ))}
        </ul>
      )}

      <h2 className="civ-heading">はい・いいえで絞る</h2>
      <p className="civ-text" data-muted="true">
        7〜12問のはい・いいえで対象を二分探索します。
      </p>
      {!started ? (
        <button type="button" className={cn("civ-interactive", "civ-button")} data-variant="secondary" onClick={startYesNo}>
          はい・いいえ形式で始める
        </button>
      ) : yesnoResolved ? (
        <div>
          <p className="civ-text">{yesnoResolved.scientific_name}({yesnoAsked}問で確定)</p>
          <button
            type="button"
            className={cn("civ-interactive", "civ-button")}
            data-variant={chosen?.qid === yesnoResolved.qid ? "primary" : "ghost"}
            onClick={() => setChosen(yesnoResolved)}
          >
            この候補を選ぶ
          </button>
        </div>
      ) : question ? (
        <div>
          <p className="civ-text">{question.pivot} 以降ですか?(残り約{question.remaining}件)</p>
          <button type="button" className={cn("civ-interactive", "civ-button")} data-variant="secondary" onClick={() => answer(true)}>
            はい
          </button>
          <button type="button" className={cn("civ-interactive", "civ-button")} data-variant="secondary" onClick={() => answer(false)}>
            いいえ
          </button>
        </div>
      ) : null}

      <h2 className="civ-heading">分類ツリーから選ぶ</h2>
      {treePath.length > 0 && (
        <p className="civ-text" data-muted="true">
          {treePath.join(" › ")}
        </p>
      )}
      {treeResolved ? (
        <div>
          <p className="civ-text">{treeResolved.scientific_name}</p>
          <button
            type="button"
            className={cn("civ-interactive", "civ-button")}
            data-variant={chosen?.qid === treeResolved.qid ? "primary" : "ghost"}
            onClick={() => setChosen(treeResolved)}
          >
            この候補を選ぶ
          </button>
          <button type="button" className={cn("civ-interactive", "civ-button")} data-variant="ghost" onClick={() => void loadTreeLevel([])}>
            最初から選び直す
          </button>
        </div>
      ) : (
        <ul className="civ-list">
          {treeChildren.map((child) => (
            <li key={child}>
              <button
                type="button"
                className={cn("civ-interactive", "civ-button")}
                data-variant="ghost"
                onClick={() => void loadTreeLevel([...treePath, child])}
              >
                {child}
              </button>
            </li>
          ))}
        </ul>
      )}

      {chosen && (
        <button type="button" className={cn("civ-interactive", "civ-button")} data-variant="primary" onClick={continueTo}>
          {confirmLabel ?? "この対象で観測を続ける"}
        </button>
      )}
    </div>
  );
}

// V3-UIX-37(uib05・b2think §1-4案1): 体長/体重の数値レンジ絞り込み行は構造完全一致
// のため共通化。★2026-08-01是正(R0801-95b347=UIB05A-1○85点「このほうが綺麗」):
// 操作方式を「中心値±幅」固定から「以上/以下/付近」の常時表示・クリック選択(civ-segmented
// 既存パターン=並び替え行と同じ役物を再利用・新規発明なし)へ変更。「付近」選択時のみ
// 中心値±幅の入力を出す(現行方式は「付近」に畳む)。上限キャップなし・自由入力・0件可。
type NumericFilterRowProps = {
  label: string;
  idBase: string;
  mode: NumericFilterMode;
  onModeChange: (m: NumericFilterMode) => void;
  modeAriaLabel: string;
  valueDraft: string;
  onValueChange: (v: string) => void;
  centerDraft: string;
  widthDraft: string;
  onCenterChange: (v: string) => void;
  onWidthChange: (v: string) => void;
  onCommit: () => void;
  widthAriaLabel: string;
  centerAriaLabel: string;
  valueAriaLabel: string;
};

const NUMERIC_FILTER_MODE_LABELS: Record<NumericFilterMode, string> = {
  gte: "以上",
  lte: "以下",
  near: "付近",
};

function NumericFilterRow({
  label,
  idBase,
  mode,
  onModeChange,
  modeAriaLabel,
  valueDraft,
  onValueChange,
  centerDraft,
  widthDraft,
  onCenterChange,
  onWidthChange,
  onCommit,
  widthAriaLabel,
  centerAriaLabel,
  valueAriaLabel,
}: NumericFilterRowProps) {
  return (
    <div className="civ-picker-row">
      <span className="civ-label">{label}</span>
      <div className="civ-segmented" role="radiogroup" aria-label={modeAriaLabel}>
        {(Object.keys(NUMERIC_FILTER_MODE_LABELS) as NumericFilterMode[]).map((m) => (
          <label key={m} className="civ-segment">
            <input
              type="radio"
              name={`${idBase}-mode`}
              checked={mode === m}
              onChange={() => onModeChange(m)}
            />
            <span>{NUMERIC_FILTER_MODE_LABELS[m]}</span>
          </label>
        ))}
      </div>
      {mode === "near" ? (
        <>
          <input
            id={`${idBase}-x`}
            className="civ-input"
            type="number"
            inputMode="decimal"
            placeholder="中心値"
            aria-label={centerAriaLabel}
            value={centerDraft}
            onChange={(e) => onCenterChange(e.target.value)}
            onBlur={onCommit}
            onKeyDown={(e) => e.key === "Enter" && onCommit()}
          />
          <span className="civ-text" data-muted="true">
            ±
          </span>
          <input
            className="civ-input"
            type="number"
            inputMode="decimal"
            placeholder="幅"
            aria-label={widthAriaLabel}
            value={widthDraft}
            onChange={(e) => onWidthChange(e.target.value)}
            onBlur={onCommit}
            onKeyDown={(e) => e.key === "Enter" && onCommit()}
          />
        </>
      ) : (
        <input
          id={`${idBase}-value`}
          className="civ-input"
          type="number"
          inputMode="decimal"
          placeholder={mode === "gte" ? "以上の値" : "以下の値"}
          aria-label={valueAriaLabel}
          value={valueDraft}
          onChange={(e) => onValueChange(e.target.value)}
          onBlur={onCommit}
          onKeyDown={(e) => e.key === "Enter" && onCommit()}
        />
      )}
    </div>
  );
}

// F2研究者モード配線(g81-f2wiring T1)。screen-defs/obs-search.json の「研究者」タブ
// (node type: "research-panel")がこのコンポーネントに委譲する。ResearchPanel
// (apps/web/src/research/ResearchPanel.tsx)は manifestInfo/onRunQuery を注入で受け
// 取るテスト容易な設計のため、ここで manifest-client.ts(フェッチ)+ duckdb-client.ts
// (遅延ロード・登録・実行)を配線する。duckdb-wasm 自体はここで静的importしていない
// (loadDuckDb() 内の動的importのまま=F0実測の遅延ロードを維持)。
function ResearchPanelNode() {
  const resolve = useContext(MessagesCtx);
  const execute = useContext(ExecuteCtx);
  const [manifestInfo, setManifestInfo] = useState<ManifestLatestInfo | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const registeredGenerationRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await fetchManifestLatest();
        if (!cancelled) setManifestInfo(info);
      } catch (e) {
        if (!cancelled) setManifestError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRunQuery = useCallback(
    async (sql: string, params: unknown[]) => {
      if (!manifestInfo || manifestInfo.generation === null) {
        throw new Error("manifest not generated yet");
      }
      const db = await loadDuckDb();
      if (registeredGenerationRef.current !== manifestInfo.generation) {
        const bytes = await fetchManifestParquet(manifestInfo.generation);
        await registerManifest(db, bytes);
        registeredGenerationRef.current = manifestInfo.generation;
      }
      return runResearchQuery(db, sql, params);
    },
    [manifestInfo],
  );

  const handleSaveToTruth = useCallback(
    async (query: ResearchQueryJson, manifestGeneration: number) => {
      const me = (await execute({ kind: "api", method: "GET", path: "/api/v1/me/profile" })) as
        | { actor_id?: string }
        | undefined;
      const actorId = me?.actor_id;
      if (!actorId) throw new Error("actor_id not available (not signed in?)");
      await saveResearchQueryToTruth(query, manifestGeneration, actorId);
    },
    [execute],
  );

  if (manifestError) {
    return (
      <p className="civ-empty" data-testid="research-panel-manifest-error">
        {manifestError}
      </p>
    );
  }
  if (!manifestInfo) return null;
  return (
    <ResearchPanel
      manifestInfo={manifestInfo}
      onRunQuery={handleRunQuery}
      resolve={resolve}
      onSaveToTruth={handleSaveToTruth}
    />
  );
}

// g81-bundleD配線: screen-defs/individual-universe.json の node
// {type:"graph-view"} がこのコンポーネントに委譲する。GraphView(graph-view/
// GraphView.tsx)は individuals/links を props で受け取るだけの再利用可能な部品
// (uib09検索グラフビューが同じ形で後から乗る想定)なので、ここでデータ取得
// (GET /individuals + /individuals/pedigree-links・HeaderScope配線は
// SearchNavigatorNode と同じ規約)と ?focus=id の受け渡し・
// 個体詳細への遷移(navigate)だけを配線する。
function GraphViewNode() {
  const execute = useContext(ExecuteCtx);
  const headerScope = useContext(HeaderScopeCtx);
  const scope = useContext(ScopeCtx);
  const navigate = useContext(NavigateCtx);
  const [individuals, setIndividuals] = useState<GraphViewIndividual[]>([]);
  const [links, setLinks] = useState<PedigreeLink[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadError(null);
      try {
        const [ind, pl] = await Promise.all([
          execute({
            kind: "api",
            method: "GET",
            path: `/api/v1/individuals${headerScopeQuery(headerScope)}`,
          }) as Promise<{ individuals?: GraphViewIndividual[] } | undefined>,
          execute({
            kind: "api",
            method: "GET",
            path: `/api/v1/individuals/pedigree-links${headerScopeQuery(headerScope)}`,
          }) as Promise<{ links?: PedigreeLink[] } | undefined>,
        ]);
        if (!alive) return;
        setIndividuals(ind?.individuals ?? []);
        setLinks(pl?.links ?? []);
      } catch (e) {
        if (alive) setLoadError(errorText(e));
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headerScope.species, headerScope.lineageId, retryTick]);

  if (!loaded) {
    return (
      <p className="civ-text" data-muted="true">
        読み込み中…
      </p>
    );
  }
  if (loadError) {
    return (
      <div className="civ-empty">
        <p className="civ-text">読み込みに失敗しました。({loadError})</p>
        <button
          type="button"
          className={cn("civ-interactive", "civ-button")}
          data-variant="secondary"
          onClick={() => {
            setLoaded(false);
            setRetryTick((t) => t + 1);
          }}
        >
          再試行
        </button>
      </div>
    );
  }
  return (
    <GraphView
      individuals={individuals}
      links={links}
      focusId={scope.params.focus || null}
      onOpenDetail={(id) => navigate("individual-detail", { id })}
      emptyHref="/finder/finder.html"
      emptyLabel="ファインダーの一覧"
    />
  );
}

// 構造要約(c8 UI磨きR0801-9d452f-ui13rendererdoc・screen-defs/obs-search.json
// はnode {type:"search-navigator"} 1個のみでこのコンポーネントに委譲。動作影響なし):
//   GET /individuals + GET /placements 取得 → 保存検索チップ(localStorage)+
//   ファセット絞り込み(0件緩和バー付き)→ 4択ソート → 下部固定バスケット
//   (選択して次の一括操作へ引き継ぐ)。
//   状態: 取得データ2種+ファセット選択+ソート+バスケット選択集合。
function SearchNavigatorNode({ tabId }: { tabId?: string }) {
  const execute = useContext(ExecuteCtx);
  const navigate = useContext(NavigateCtx);
  const headerScope = useContext(HeaderScopeCtx);

  const [individuals, setIndividuals] = useState<SearchRow[]>([]);
  const [placements, setPlacements] = useState<PlacementRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_SEARCH_FILTERS);
  const [sort, setSort] = useState<SearchSort>(DEFAULT_SEARCH_SORT);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [activeSavedId, setActiveSavedId] = useState<string | null>(null);

  const [lengthMode, setLengthMode] = useState<NumericFilterMode>("near");
  const [lengthValueDraft, setLengthValueDraft] = useState("");
  const [lengthXDraft, setLengthXDraft] = useState("");
  const [lengthYDraft, setLengthYDraft] = useState("");
  const [weightMode, setWeightMode] = useState<NumericFilterMode>("near");
  const [weightValueDraft, setWeightValueDraft] = useState("");
  const [weightXDraft, setWeightXDraft] = useState("");
  const [weightYDraft, setWeightYDraft] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);

  // T2(E1横断検索UI導線・R0801-d5e912=GET /api/v1/search 完成済みAPIへの入口)。
  // このフィルタ群(種/ステージ/体長/体重)は取得済みの個体一覧に対するクライアント側の
  // 絞り込みだが、横断検索は index/receipt/ を日付範囲でサーバ側走査する別機能のため、
  // 状態・実行を分離する(既存の個体フィルタと混ぜない)。
  const [crossOpen, setCrossOpen] = useState(false);
  const [crossQueryDraft, setCrossQueryDraft] = useState("");
  const [crossTypeDraft, setCrossTypeDraft] = useState("");
  const [crossLoading, setCrossLoading] = useState(false);
  const [crossError, setCrossError] = useState<string | null>(null);
  const [crossResult, setCrossResult] = useState<CrossSearchResponse | null>(null);

  // T-A3(V3-UIX-40残り「色検索」): 横断検索と同じ「取得済み個体一覧とは別軸の
  // サーバ問い合わせ」パターンで独立させる(既存のfilters/sortedへ混ぜ込むと
  // 色情報を持たない個体の扱い(除外)が既存のファセットロジックと衝突するため)。
  const [colorOpen, setColorOpen] = useState(false);
  // 色検索の初期スウォッチに固定の意匠色を持たせる product 要件は無い。ソース中に
  // 生の "#rrggbb" リテラルを一切書かず(scripts/check-ui-tokens.mjs GATE・
  // design-c2 §4.4)、既存トークン(--civ-primary・apps/web/src/app/tokens.generated.css)
  // をマウント後に DOM から読んで初期値にする(このtsxはSSRもされるためuseState初期値は
  // "" のままにし、client専用の getComputedStyle は下のuseEffectで呼ぶ)。
  const [colorHexDraft, setColorHexDraft] = useState("");
  const [colorLoading, setColorLoading] = useState(false);
  const [colorError, setColorError] = useState<string | null>(null);
  const [colorResult, setColorResult] = useState<ColorSearchResponse | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [basketExpanded, setBasketExpanded] = useState(false);
  const [snack, setSnack] = useState<{ ids: string[] } | null>(null);
  const snackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // マウント後(client側)のみ実行。--civ-primary を DOM から読む(tsx中に
    // hexリテラルを書かない=GATE適合)。colorHexDraftをユーザーが既に触っていたら
    // 上書きしない。
    if (colorHexDraft) return;
    const fromToken = getComputedStyle(document.documentElement)
      .getPropertyValue("--civ-primary")
      .trim();
    if (fromToken) setColorHexDraft(fromToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadError(null);
      try {
        // HDR-1(c9-structure-canon.md §1/R112/R115): ヘッダー観測対象セレクタの
        // 選択をサーバ側フィルタとして付ける(individual-routes.ts の既存
        // ?species=/?lineage_id= に配線するだけ)。画面内の種/ステージ/棚チップ
        // (filters state)はこの母集団に対する二次的な絞り込みのまま(A1#4:
        // localStorage 内だけで完結する旧・画面内ファセットではなくサーバ母集団
        // 自体がヘッダー選択に従う)。
        const [ind, pl] = await Promise.all([
          execute({ kind: "api", method: "GET", path: `/api/v1/individuals${headerScopeQuery(headerScope)}` }) as Promise<
            { individuals?: SearchRow[] } | undefined
          >,
          execute({ kind: "api", method: "GET", path: "/api/v1/placements" }) as Promise<
            { placements?: PlacementRow[] } | undefined
          >,
        ]);
        if (!alive) return;
        setIndividuals((ind?.individuals ?? []).map((i) => ({ ...i, label: safeLabel(i.label, i.species) })));
        setPlacements(pl?.placements ?? []);
        setSavedSearches(loadSavedSearches());
        // 直近条件の自動復元: 「読み込み中…」ゲートの裏でここまで適用してから
        // loaded を立てるので、未フィルタの全件表示が一瞬でも画面に出ない。
        const last = loadLastFilter();
        if (last) {
          setFilters(last.filters);
          setSort(last.sort);
          setLengthMode(last.filters.lengthMode);
          setLengthValueDraft(last.filters.lengthValue != null ? String(last.filters.lengthValue) : "");
          setLengthXDraft(last.filters.lengthCenter != null ? String(last.filters.lengthCenter) : "");
          setLengthYDraft(last.filters.lengthWidth != null ? String(last.filters.lengthWidth) : "");
          setWeightMode(last.filters.weightMode);
          setWeightValueDraft(last.filters.weightValue != null ? String(last.filters.weightValue) : "");
          setWeightXDraft(last.filters.weightCenter != null ? String(last.filters.weightCenter) : "");
          setWeightYDraft(last.filters.weightWidth != null ? String(last.filters.weightWidth) : "");
        }
      } catch (e) {
        if (alive) setLoadError(errorText(e));
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
    // headerScope の primitives のみを deps にする(オブジェクト参照ではなく
    // 値で比較 — AppShellNode 側の再レンダーで参照が変わっても値が同じなら
    // 再フェッチしない)。ヘッダーで選択を変えたら個体母集団を取り直す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headerScope.species, headerScope.lineageId, retryTick]);

  // 直近条件の永続化(初回ロード後のみ — 復元直後の再書き込みで壊さない)。
  useEffect(() => {
    if (!loaded) return;
    saveLastFilter(filters, sort);
  }, [loaded, filters, sort]);

  const placementLabel = useCallback(
    (id: string | null) => placements.find((p) => p.placement_id === id)?.label ?? "",
    [placements],
  );

  const speciesValues = useMemo(
    () => Array.from(new Set(individuals.map((i) => i.species).filter((v): v is string => !!v))).sort(),
    [individuals],
  );
  const stageValues = useMemo(
    () => Array.from(new Set(individuals.map((i) => i.stage).filter((v): v is string => !!v))),
    [individuals],
  );
  const shelfValues = useMemo(
    () => Array.from(new Set(individuals.map((i) => i.placement_id).filter((v): v is string => !!v))),
    [individuals],
  );

  const filtered = useMemo(() => individuals.filter((r) => matchesFilters(r, filters)), [individuals, filters]);
  const sorted = useMemo(() => sortRows(filtered, sort), [filtered, sort]);
  const totalCaptures = filtered.reduce((sum, r) => sum + (r.capture_count ?? 0), 0);

  const commitLength = (modeArg?: NumericFilterMode) => {
    const mode = modeArg ?? lengthMode;
    if (mode === "near") {
      const xRaw = lengthXDraft.trim();
      const yRaw = lengthYDraft.trim();
      const x = xRaw === "" ? null : Number(xRaw);
      const y = yRaw === "" ? null : Number(yRaw);
      setFilters((f) => ({
        ...f,
        lengthMode: mode,
        lengthCenter: x != null && Number.isFinite(x) ? x : null,
        lengthWidth: y != null && Number.isFinite(y) ? y : null,
        lengthValue: null,
      }));
    } else {
      const raw = lengthValueDraft.trim();
      const v = raw === "" ? null : Number(raw);
      setFilters((f) => ({
        ...f,
        lengthMode: mode,
        lengthValue: v != null && Number.isFinite(v) ? v : null,
        lengthCenter: null,
        lengthWidth: null,
      }));
    }
  };
  const handleLengthModeChange = (m: NumericFilterMode) => {
    setLengthMode(m);
    commitLength(m);
  };
  const commitWeight = (modeArg?: NumericFilterMode) => {
    const mode = modeArg ?? weightMode;
    if (mode === "near") {
      const xRaw = weightXDraft.trim();
      const yRaw = weightYDraft.trim();
      const x = xRaw === "" ? null : Number(xRaw);
      const y = yRaw === "" ? null : Number(yRaw);
      setFilters((f) => ({
        ...f,
        weightMode: mode,
        weightCenter: x != null && Number.isFinite(x) ? x : null,
        weightWidth: y != null && Number.isFinite(y) ? y : null,
        weightValue: null,
      }));
    } else {
      const raw = weightValueDraft.trim();
      const v = raw === "" ? null : Number(raw);
      setFilters((f) => ({
        ...f,
        weightMode: mode,
        weightValue: v != null && Number.isFinite(v) ? v : null,
        weightCenter: null,
        weightWidth: null,
      }));
    }
  };
  const handleWeightModeChange = (m: NumericFilterMode) => {
    setWeightMode(m);
    commitWeight(m);
  };

  // T2(E1横断検索UI導線): 完成済みAPI GET /api/v1/search(R0801-d5e912実装)を叩く。
  // 期間指定は送らない(サーバ側の既定=直近7日をそのまま使い、レスポンスのquery.from/to
  // を画面に表示することで「実際に使われた期間」を正直に見せる)。
  const runCrossSearch = async () => {
    setCrossLoading(true);
    setCrossError(null);
    try {
      const params = new URLSearchParams();
      const q = crossQueryDraft.trim();
      if (q) params.set("q", q);
      const type = crossTypeDraft.trim();
      if (type) params.set("type", type);
      const qs = params.toString();
      const res = (await execute({
        kind: "api",
        method: "GET",
        path: `/api/v1/search${qs ? `?${qs}` : ""}`,
      })) as CrossSearchResponse | undefined;
      if (res) setCrossResult(res);
      else setCrossError("検索に失敗しました(応答がありません)");
    } catch {
      setCrossError("検索に失敗しました");
    } finally {
      setCrossLoading(false);
    }
  };

  // T-A3(色検索): 選んだ色(HTML標準 <input type="color"> = ブラウザ内蔵のスポイト
  // 相当・新規UI部品の自作なし)を #RRGGBB のまま送り、Lab変換とΔE76計算はサーバ側
  // (individual-routes.ts hexToLab)で行う。ヘッダースコープ(種/系統選択)は既存の
  // 個体一覧取得と同じ母集団に揃えるため引き継ぐ。
  const runColorSearch = async () => {
    setColorLoading(true);
    setColorError(null);
    try {
      const params = new URLSearchParams();
      if (headerScope.species) params.set("species", headerScope.species);
      if (headerScope.lineageId) params.set("lineage_id", headerScope.lineageId);
      params.set("color_hex", colorHexDraft.replace(/^#/, ""));
      const res = (await execute({
        kind: "api",
        method: "GET",
        path: `/api/v1/individuals?${params.toString()}`,
      })) as ColorSearchResponse | undefined;
      if (res) setColorResult(res);
      else setColorError("色検索に失敗しました(応答がありません)");
    } catch {
      setColorError("色検索に失敗しました");
    } finally {
      setColorLoading(false);
    }
  };

  const toggleFacet = (key: "species" | "stage" | "shelf", value: string) => {
    setFilters((f) => ({ ...f, [key]: f[key] === value ? null : value }));
  };

  // 0件時の緩和バー: 現在アクティブなファセット/レンジごとに「これを外したら
  // 何件になるか」を計算し、実際に効くもの(>0件)だけ1タップ導線として出す。
  const reliefOptions = useMemo(() => {
    if (sorted.length > 0) return [];
    const opts: { key: string; label: string; count: number; apply: () => void }[] = [];
    if (filters.species != null) {
      const next = { ...filters, species: null };
      const count = individuals.filter((r) => matchesFilters(r, next)).length;
      if (count > 0) opts.push({ key: "species", label: `${filters.species}を外す`, count, apply: () => setFilters(next) });
    }
    if (filters.stage != null) {
      const next = { ...filters, stage: null };
      const count = individuals.filter((r) => matchesFilters(r, next)).length;
      if (count > 0)
        opts.push({
          key: "stage",
          label: `${STAGE_LABELS_JA[filters.stage] ?? filters.stage}を外す`,
          count,
          apply: () => setFilters(next),
        });
    }
    if (filters.shelf != null) {
      const next = { ...filters, shelf: null };
      const count = individuals.filter((r) => matchesFilters(r, next)).length;
      if (count > 0)
        opts.push({ key: "shelf", label: `${placementLabel(filters.shelf) || "棚"}を外す`, count, apply: () => setFilters(next) });
    }
    if (filters.lengthValue != null || (filters.lengthCenter != null && filters.lengthWidth != null)) {
      const next = { ...filters, lengthValue: null, lengthCenter: null, lengthWidth: null };
      const count = individuals.filter((r) => matchesFilters(r, next)).length;
      if (count > 0)
        opts.push({
          key: "length",
          label: "体長の絞り込みを外す",
          count,
          apply: () => {
            setFilters(next);
            setLengthValueDraft("");
            setLengthXDraft("");
            setLengthYDraft("");
          },
        });
    }
    if (filters.weightValue != null || (filters.weightCenter != null && filters.weightWidth != null)) {
      const next = { ...filters, weightValue: null, weightCenter: null, weightWidth: null };
      const count = individuals.filter((r) => matchesFilters(r, next)).length;
      if (count > 0)
        opts.push({
          key: "weight",
          label: "体重の絞り込みを外す",
          count,
          apply: () => {
            setFilters(next);
            setWeightValueDraft("");
            setWeightXDraft("");
            setWeightYDraft("");
          },
        });
    }
    return opts;
  }, [sorted.length, filters, individuals, placementLabel]);

  const applyFilterState = (f: SearchFilters, s: SearchSort) => {
    setFilters(f);
    setSort(s);
    setLengthMode(f.lengthMode);
    setLengthValueDraft(f.lengthValue != null ? String(f.lengthValue) : "");
    setLengthXDraft(f.lengthCenter != null ? String(f.lengthCenter) : "");
    setLengthYDraft(f.lengthWidth != null ? String(f.lengthWidth) : "");
    setWeightMode(f.weightMode);
    setWeightValueDraft(f.weightValue != null ? String(f.weightValue) : "");
    setWeightXDraft(f.weightCenter != null ? String(f.weightCenter) : "");
    setWeightYDraft(f.weightWidth != null ? String(f.weightWidth) : "");
  };

  const saveCurrentSearch = () => {
    const name = window.prompt("この条件を保存する名前を入力してください");
    if (!name) return;
    const entry: SavedSearch = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      filters,
      sort,
    };
    const next = [...savedSearches, entry];
    setSavedSearches(next);
    persistSavedSearches(next);
    setActiveSavedId(entry.id);
  };
  const applySavedSearch = (s: SavedSearch) => {
    applyFilterState(s.filters, s.sort);
    setActiveSavedId(s.id);
  };
  const deleteSavedSearch = (id: string) => {
    const next = savedSearches.filter((s) => s.id !== id);
    setSavedSearches(next);
    persistSavedSearches(next);
    if (activeSavedId === id) setActiveSavedId(null);
  };

  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const clearBasket = () => {
    if (selected.size === 0) return;
    const prev = [...selected];
    setSelected(new Set());
    setBasketExpanded(false);
    if (snackTimer.current) clearTimeout(snackTimer.current);
    setSnack({ ids: prev });
    snackTimer.current = setTimeout(() => setSnack(null), 5000);
  };
  const undoClear = () => {
    if (!snack) return;
    if (snackTimer.current) clearTimeout(snackTimer.current);
    setSelected(new Set(snack.ids));
    setSnack(null);
  };

  const goToBatch = () => {
    savePreselect([...selected]);
    navigate("obs-register-batch");
  };

  if (!loaded) {
    return (
      <p className="civ-text" data-muted="true">
        読み込み中…
      </p>
    );
  }
  if (loadError) {
    return (
      <div className="civ-empty">
        <p className="civ-text">読み込みに失敗しました。({loadError})</p>
        <button
          type="button"
          className={cn("civ-interactive", "civ-button")}
          data-variant="secondary"
          onClick={() => {
            setLoaded(false);
            setRetryTick((t) => t + 1);
          }}
        >
          再試行
        </button>
      </div>
    );
  }

  const basketIds = [...selected];
  const activeSaved = savedSearches.find((s) => s.id === activeSavedId) ?? null;
  const savedDirty = activeSaved != null && !filtersEqual(activeSaved.filters, filters);

  return (
    <div className="civ-form civ-search-navigator">
      {tabId === "breeder" && (
        <p className="civ-text" data-muted="true">
          ※ブリーダー向けの専用表示はこれから設計します。いまは「一般」と同じ内容です
        </p>
      )}
      <div className="civ-chip-row">
        {savedSearches.map((s) => (
          <span key={s.id} className="civ-saved-chip-wrap">
            <button
              type="button"
              className={cn("civ-interactive", "civ-badge", "civ-facet-chip")}
              data-active={s.id === activeSavedId || undefined}
              onClick={() => applySavedSearch(s)}
            >
              {s.name}
              {s.id === activeSavedId && savedDirty ? " ✱" : ""}
            </button>
            <button
              type="button"
              className={cn("civ-interactive", "civ-chip-remove")}
              aria-label={`${s.name} を削除`}
              onClick={() => deleteSavedSearch(s.id)}
            >
              ✕
            </button>
          </span>
        ))}
        <button
          type="button"
          className={cn("civ-interactive", "civ-button")}
          data-variant="ghost"
          data-compact
          onClick={saveCurrentSearch}
        >
          ＋今の条件を保存
        </button>
      </div>

      <p className="civ-text">
        {sorted.length}個体 / {totalCaptures}枚
      </p>

      <div className="civ-disclosure" data-open={filterOpen || undefined}>
        <button
          type="button"
          className={cn("civ-interactive", "civ-button", "civ-disclosure-trigger")}
          data-variant="secondary"
          aria-expanded={filterOpen}
          onClick={() => setFilterOpen((o) => !o)}
        >
          絞り込み {filterOpen ? "▾" : "▸"}
        </button>
        {filterOpen && (
          <div className="civ-disclosure-body">
            {speciesValues.length > 0 && (
              <div className="civ-chip-row">
                {speciesValues.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={cn("civ-interactive", "civ-badge", "civ-facet-chip")}
                    data-active={filters.species === v || undefined}
                    onClick={() => toggleFacet("species", v)}
                  >
                    {v}({facetCount(individuals, filters, "species", v)})
                  </button>
                ))}
              </div>
            )}
            {stageValues.length > 0 && (
              <div className="civ-chip-row">
                {stageValues.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={cn("civ-interactive", "civ-badge", "civ-facet-chip")}
                    data-active={filters.stage === v || undefined}
                    onClick={() => toggleFacet("stage", v)}
                  >
                    {STAGE_LABELS_JA[v] ?? v}({facetCount(individuals, filters, "stage", v)})
                  </button>
                ))}
              </div>
            )}
            {shelfValues.length > 0 && (
              <div className="civ-chip-row">
                {shelfValues.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={cn("civ-interactive", "civ-badge", "civ-facet-chip")}
                    data-active={filters.shelf === v || undefined}
                    onClick={() => toggleFacet("shelf", v)}
                  >
                    {placementLabel(v) || v}({facetCount(individuals, filters, "shelf", v)})
                  </button>
                ))}
              </div>
            )}
            <NumericFilterRow
              label="体長(mm)"
              idBase="search-length"
              mode={lengthMode}
              onModeChange={handleLengthModeChange}
              modeAriaLabel="体長の絞り込み方法"
              valueDraft={lengthValueDraft}
              onValueChange={setLengthValueDraft}
              centerDraft={lengthXDraft}
              widthDraft={lengthYDraft}
              onCenterChange={setLengthXDraft}
              onWidthChange={setLengthYDraft}
              onCommit={() => commitLength()}
              widthAriaLabel="体長の幅"
              centerAriaLabel="体長の中心値"
              valueAriaLabel="体長の値"
            />
            <NumericFilterRow
              label="体重(g)"
              idBase="search-weight"
              mode={weightMode}
              onModeChange={handleWeightModeChange}
              modeAriaLabel="体重の絞り込み方法"
              valueDraft={weightValueDraft}
              onValueChange={setWeightValueDraft}
              centerDraft={weightXDraft}
              widthDraft={weightYDraft}
              onCenterChange={setWeightXDraft}
              onWidthChange={setWeightYDraft}
              onCommit={() => commitWeight()}
              widthAriaLabel="体重の幅"
              centerAriaLabel="体重の中心値"
              valueAriaLabel="体重の値"
            />
          </div>
        )}
      </div>

      {/* T2(E1横断検索UI導線・R0801-d5e912=GET /api/v1/search 完成済みAPIの入口)。
          上の絞り込みは取得済み個体一覧の二次フィルタだが、これは全観測イベントを
          日付範囲でサーバ側から探す別機能なので別の開閉セクションにする。 */}
      <div className="civ-disclosure" data-open={crossOpen || undefined}>
        <button
          type="button"
          className={cn("civ-interactive", "civ-button", "civ-disclosure-trigger")}
          data-variant="secondary"
          aria-expanded={crossOpen}
          onClick={() => setCrossOpen((o) => !o)}
        >
          横断検索(全記録から探す) {crossOpen ? "▾" : "▸"}
        </button>
        {crossOpen && (
          <div className="civ-disclosure-body">
            <p className="civ-text" data-muted="true">
              個体だけでなく観測・取引・話し合いなど全ての記録をフリーテキストで探します。既定は直近7日・最大90日まで指定可。
            </p>
            <div className="civ-field">
              <label className="civ-label" htmlFor="cross-search-q">
                キーワード
              </label>
              <input
                id="cross-search-q"
                className="civ-input"
                type="text"
                value={crossQueryDraft}
                onChange={(e) => setCrossQueryDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runCrossSearch()}
                placeholder="例: 産卵、脱皮、取引 など"
              />
            </div>
            <div className="civ-field">
              <label className="civ-label" htmlFor="cross-search-type">
                種類(type)で絞り込み(任意)
              </label>
              <input
                id="cross-search-type"
                className="civ-input"
                type="text"
                value={crossTypeDraft}
                onChange={(e) => setCrossTypeDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runCrossSearch()}
                placeholder="例: observation"
              />
            </div>
            <button
              type="button"
              className={cn("civ-interactive", "civ-button")}
              data-variant="primary"
              onClick={runCrossSearch}
              disabled={crossLoading}
            >
              {crossLoading ? "検索中…" : "横断検索する"}
            </button>
            {crossError && (
              <p className="civ-text" data-variant="error">
                {crossError}
              </p>
            )}
            {crossResult && (
              <div className="civ-cross-search-results">
                <p className="civ-text" data-muted="true">
                  検索期間: {crossResult.query.from} 〜 {crossResult.query.to} / {crossResult.count}件
                </p>
                {crossResult.truncated && (
                  <p className="civ-text" data-variant="warning">
                    打ち切りあり: {crossResult.truncated_dates.join("、")}
                    の日付は1000件天井に達したため、この範囲内の全件ではありません。
                  </p>
                )}
                {crossResult.results.length === 0 ? (
                  <p className="civ-text" data-muted="true">該当する記録がありません。</p>
                ) : (
                  <ul className="civ-list">
                    {crossResult.results.map((r) => (
                      <li key={r.event_id} className="civ-list-row">
                        <span className="civ-badge">{r.type}</span>
                        <span className="civ-text">{r.text_repr ?? "(内容の要約なし・未知の記録型)"}</span>
                        <span className="civ-text" data-muted="true">
                          {r.received_at}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* T-A3(V3-UIX-40残り「色検索」・g90-w2search): 上の横断検索と同じ独立
          開閉セクション。色は個体一覧の二次フィルタではなく別問い合わせ(サーバ側で
          ΔE76を計算する必要があるため)なので、既存のfiltersには混ぜない。 */}
      <div className="civ-disclosure" data-open={colorOpen || undefined}>
        <button
          type="button"
          className={cn("civ-interactive", "civ-button", "civ-disclosure-trigger")}
          data-variant="secondary"
          aria-expanded={colorOpen}
          onClick={() => setColorOpen((o) => !o)}
        >
          色検索(近い色の個体を探す) {colorOpen ? "▾" : "▸"}
        </button>
        {colorOpen && (
          <div className="civ-disclosure-body">
            <p className="civ-text" data-muted="true">
              色を選ぶと、直近の撮影記録から近い体色の個体を探します。過去に撮影した記録は色の情報を持たないため対象外です(g80-e2color・遡及は未実施)。
            </p>
            <div className="civ-field">
              <label className="civ-label" htmlFor="color-search-picker">
                色を選ぶ
              </label>
              <input
                id="color-search-picker"
                type="color"
                value={colorHexDraft}
                onChange={(e) => setColorHexDraft(e.target.value)}
                aria-label="検索する色"
              />
            </div>
            <button
              type="button"
              className={cn("civ-interactive", "civ-button")}
              data-variant="primary"
              onClick={runColorSearch}
              disabled={colorLoading}
            >
              {colorLoading ? "検索中…" : "この色に近い個体を探す"}
            </button>
            {colorError && (
              <p className="civ-text" data-variant="error">
                {colorError}
              </p>
            )}
            {colorResult && (
              <div className="civ-color-search-results">
                <p className="civ-text" data-muted="true">
                  {colorResult.individuals.length}個体がヒット
                  {colorResult.color_search.excluded_no_color > 0
                    ? `(色情報が無いため対象外: ${colorResult.color_search.excluded_no_color}個体)`
                    : ""}
                </p>
                {colorResult.individuals.length === 0 ? (
                  <p className="civ-text" data-muted="true">近い色の個体が見つかりませんでした。</p>
                ) : (
                  <ul className="civ-list">
                    {colorResult.individuals.map((r) => (
                      <li key={r.individual_id} className="civ-list-row">
                        {r.thumbnail_path && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className="civ-search-thumb" src={r.thumbnail_path} alt="" />
                        )}
                        <button
                          type="button"
                          className={cn("civ-interactive", "civ-link")}
                          onClick={() => navigate("individual-detail", { id: r.individual_id })}
                        >
                          {r.label}
                        </button>
                        {r.species && <Badge text={r.species} tone="neutral" />}
                        <span className="civ-text" data-muted="true">
                          色の近さ(ΔE {r.color_distance.toFixed(1)})
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {sorted.length === 0 && reliefOptions.length > 0 && (
        <div className="civ-relief-bar">
          {reliefOptions.map((o) => (
            <button
              key={o.key}
              type="button"
              className={cn("civ-interactive", "civ-button")}
              data-variant="secondary"
              data-compact
              onClick={o.apply}
            >
              {o.label} → {o.count}件
            </button>
          ))}
        </div>
      )}
      {sorted.length === 0 && reliefOptions.length === 0 && (
        <p className="civ-text" data-muted="true">
          該当する個体がいません。
        </p>
      )}

      {/* T2(w1-finder・LAUNCH1600-1 B案採用 — finder.htmlの表(Tabulator)ライクな
          見た目に寄せる。列ヘッダをクリックすると即sortされる(finder.htmlの
          「列ヘッダクリックで即sort」を踏襲)。既存の並び替えセグメントは
          finder.htmlに無い日付系ソート(最終観測日/羽化日)のために残す。
          新規CSSクラスは追加しない(既存 .civ-table を obs-batch.tsx から再利用
          =reuse-first。触ってよいファイルが zones/search.tsx のみのため
          globals.css には触れない)。 */}
      <div className="civ-segmented" role="radiogroup" aria-label="並び替え">
        {(Object.keys(SEARCH_SORT_LABELS) as SearchSort[]).map((k) => (
          <label key={k} className="civ-segment">
            <input type="radio" checked={sort === k} onChange={() => setSort(k)} />
            <span>{SEARCH_SORT_LABELS[k]}</span>
          </label>
        ))}
      </div>

      <div className="civ-table-scroll">
        <table className="civ-table">
          <thead>
            <tr>
              <th aria-label="選択"></th>
              <th>個体</th>
              <th>種族</th>
              <th>ステージ</th>
              <th>
                <button
                  type="button"
                  className={cn("civ-interactive", "civ-button")}
                  data-variant="ghost"
                  data-compact
                  aria-pressed={sort === "length_desc"}
                  onClick={() => setSort("length_desc")}
                >
                  体長mm{sort === "length_desc" ? " ↓" : ""}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className={cn("civ-interactive", "civ-button")}
                  data-variant="ghost"
                  data-compact
                  aria-pressed={sort === "weight_desc"}
                  onClick={() => setSort("weight_desc")}
                >
                  体重g{sort === "weight_desc" ? " ↓" : ""}
                </button>
              </th>
              <th>記録</th>
              <th>個体ID</th>
              <th aria-label="操作"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const checked = selected.has(row.individual_id);
              let dateIso: string | null = null;
              let dateLabel = "";
              if (row.eclosion_at) {
                dateIso = row.eclosion_at;
                dateLabel = "羽化";
              } else if (row.last_care_at) {
                dateIso = row.last_care_at;
                dateLabel = "最終観測";
              }
              return (
                <tr
                  key={row.individual_id}
                  onClick={() => navigate("individual-detail", { id: row.individual_id })}
                  aria-label={`${row.label} の個体詳細を開く`}
                >
                  <td data-label="選択" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelect(row.individual_id)}
                      aria-label={`${row.label} を選択`}
                    />
                  </td>
                  <td data-label="個体" className="civ-cell-clip" title={row.label}>
                    {row.thumbnail_path && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="civ-search-thumb" src={row.thumbnail_path} alt="" />
                    )}
                    {row.label}
                  </td>
                  <td data-label="種族">{row.species ? <Badge text={row.species} tone="neutral" /> : "—"}</td>
                  <td data-label="ステージ">{row.stage ? STAGE_LABELS_JA[row.stage] ?? row.stage : "—"}</td>
                  <td data-label="体長mm">{row.latest_length_mm ?? "—"}</td>
                  <td data-label="体重g">{row.latest_weight_g ?? "—"}</td>
                  <td data-label="記録">
                    {dateIso ? `${dateLabel} ${relativeLabel(new Date(dateIso).getTime())}` : "記録なし"}
                    {`・観測${row.capture_count}回`}
                  </td>
                  <td data-label="個体ID" className="civ-cell-clip" title={row.individual_id}>
                    {row.individual_id}
                  </td>
                  <td data-label="操作" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className={cn("civ-interactive", "civ-button")}
                      data-variant="secondary"
                      data-compact
                      onClick={() => navigate("obs-register-entry", { id: row.individual_id })}
                    >
                      追観測 →
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(basketIds.length > 0 || snack) && (
        <div className="civ-basket-tray">
          {snack && (
            <div className="civ-snackbar">
              <span>{snack.ids.length}個体を削除しました</span>
              <button
                type="button"
                className={cn("civ-interactive", "civ-button")}
                data-variant="ghost"
                data-compact
                onClick={undoClear}
              >
                元に戻す
              </button>
            </div>
          )}
          {basketIds.length > 0 && (
            <>
              <div className="civ-basket-chips">
                {(basketExpanded ? basketIds : basketIds.slice(0, 6)).map((id) => {
                  const ind = individuals.find((i) => i.individual_id === id);
                  return (
                    <span key={id} className="civ-basket-chip">
                      {ind?.label ?? id}
                      <button
                        type="button"
                        className={cn("civ-interactive", "civ-chip-remove")}
                        aria-label={`${ind?.label ?? id} を外す`}
                        onClick={() => toggleSelect(id)}
                      >
                        ✕
                      </button>
                    </span>
                  );
                })}
                {!basketExpanded && basketIds.length > 6 && (
                  <button
                    type="button"
                    className={cn("civ-interactive", "civ-button")}
                    data-variant="ghost"
                    data-compact
                    onClick={() => setBasketExpanded(true)}
                  >
                    ＋{basketIds.length - 6} 一覧▾
                  </button>
                )}
              </div>
              <div className="civ-basket-actions">
                <button
                  type="button"
                  className={cn("civ-interactive", "civ-button")}
                  data-variant="ghost"
                  data-compact
                  onClick={clearBasket}
                >
                  空にする
                </button>
                <button
                  type="button"
                  className={cn("civ-interactive", "civ-button")}
                  data-variant="primary"
                  onClick={goToBatch}
                >
                  → 計測グリッドへ({basketIds.length}件)
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Badge/STAGE_LABELS_JA/safeLabel/PlacementRowはPhase 2b裁定(g85-split2a-
// ruling §3)でcore/primitives.tsx・core/scope.tsへ一本化済み(下記import)。
// relativeLabelはこのゾーン(search-navigator等)からのみ使われZ2専用の純関数
// のため一本化対象外(renderer.tsx zone C側の原本はPhase 3まで存置される)。
// ============================================================================

function relativeLabel(at: number): string {
  const mins = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (mins < 1) return "たった今";
  if (mins < 60) return `${mins}分前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}時間前`;
  return `${Math.round(hours / 24)}日前`;
}

registerNode("search-navigator", SearchNavigatorNode);
registerNode("target-navigator", TargetNavigatorNode);
registerNode("research-panel", ResearchPanelNode);
registerNode("graph-view", GraphViewNode);
