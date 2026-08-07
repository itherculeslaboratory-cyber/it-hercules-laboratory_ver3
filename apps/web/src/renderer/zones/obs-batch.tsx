"use client";

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { mapError } from "@/lib/error-messages";
import {
  clearBatch,
  loadBatchDraft,
  loadBatchResults,
  loadPreselect,
  saveBatchDraft,
  saveBatchResults,
  type BatchCommitItem,
  type BatchDraft,
  type BatchGroup,
  type BatchResult,
  type BatchResults,
  type DraftRow,
  type ScheduleTarget,
} from "../batch-draft";
import { ExecuteCtx, HeaderScopeCtx, NavigateCtx, ScopeCtx } from "../core/context";
import { appendHeaderScope, errorText, formatDateJa, todayPlusDays, STAGE_LABELS_JA, safeLabel, type PlacementRow } from "../core/scope";
import { registerNode } from "../core/registry";
import { Badge } from "../core/primitives";

// zones/obs-batch.tsx — g85-split2a Z1(renderer.tsx zone D「observation-batch」の
// 切り出し・KIT-TEMPLATE合格ライン=元範囲との差分ゼロ)。
// Badge/STAGE_LABELS_JA/safeLabelはPhase 2b裁定(g85-split2a-ruling §3)で
// core/primitives.tsx・core/scope.tsへ一本化済み(ローカル複製は解消)。

// =============================================================================
// V3-AIP-101 観測登録スライス2 (c7-wireframes-core5 §F3/F4/F5/F6) — クラッチ
// 割り出し(F3)・お世話/移動/クラッチ照合・昇格の一括選択(F4)・バッチ確認(F5b)
// ・バッチ完了(F6b)。いずれも複数 API 呼び出し+行単位のローカル状態を1画面内
// に持つため専用ノードにした(measurement-table と同じ縮退・ponytail: 汎用の
// list/table 語彙をここまで汎化するとかえって読みにくいので、この4画面だけの
// 専用コンポーネントに留める)。
// =============================================================================

// 「そろそろ」判定の閾値(日数)。追い立てない温度感(2026-07-12 ユーザー裁定
// 「予定は目安・赤禁止」)のニュートラルな既定値 — ユーザー単位のテンプレ化は
// 今後の波。ponytail: 固定30日、per-stage/per-userの間隔テンプレは今後の拡張。
const OVERDUE_DAYS = 30;

function daysSince(iso: string | null): number {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Infinity : (Date.now() - t) / 86_400_000;
}

// F3 の親3択で使う検索→選択ピッカー。選択済みはラベル+種のみ表示し、生ID は
// 画面に一切出さない(品質バー: ID全文非表示)。
type ParentSel = { id: string; label: string; species?: string } | null;
function ParentPicker({
  label,
  selected,
  onSelect,
  onClear,
}: {
  label: string;
  selected: ParentSel;
  onSelect: (v: ParentSel) => void;
  onClear: () => void;
}) {
  const execute = useContext(ExecuteCtx);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ individual_id: string; label: string; species?: string }>>([]);
  const [searching, setSearching] = useState(false);
  const search = useCallback(async () => {
    if (!q.trim()) return;
    setSearching(true);
    try {
      const r = (await execute({
        kind: "api",
        method: "GET",
        path: `/api/v1/individuals?q=${encodeURIComponent(q)}`,
      })) as { individuals?: Array<{ individual_id: string; label: string; species?: string }> } | undefined;
      setResults((r?.individuals ?? []).slice(0, 5));
    } finally {
      setSearching(false);
    }
  }, [q, execute]);

  if (selected) {
    return (
      <div className="civ-field">
        <span className="civ-label">{label}</span>
        <div className="civ-card-badges">
          <Badge text={selected.label} tone="neutral" />
          {selected.species && <Badge text={selected.species} tone="neutral" />}
          <button type="button" className={cn("civ-interactive", "civ-button")} data-variant="ghost" data-compact onClick={onClear}>
            ✕ 変更
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="civ-field">
      <span className="civ-label">{label}</span>
      <div className="civ-picker-row">
        <input
          className="civ-input"
          placeholder="個体・種で検索"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={`${label} を検索`}
        />
        <button
          type="button"
          className={cn("civ-interactive", "civ-button")}
          data-variant="secondary"
          data-compact
          aria-busy={searching || undefined}
          onClick={search}
        >
          🔍 検索
        </button>
      </div>
      {results.length > 0 && (
        <div className="civ-chip-row">
          {results.map((r) => (
            <button
              key={r.individual_id}
              type="button"
              className={cn("civ-interactive", "civ-card", "civ-recent-chip")}
              onClick={() => {
                onSelect({ id: r.individual_id, label: r.label, species: r.species });
                setResults([]);
                setQ("");
              }}
            >
              <span className="civ-card-title">{r.label}</span>
              {r.species && <Badge text={r.species} tone="neutral" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// F3: 割り出し・クラッチ一括(匿名プール)。保存 = POST /clutches のあと(抜き
// 取り計測があれば)POST /observation/captures を subject_ref="clutch/<id>" で
// 連鎖させる1画面完結フォーム(F4/F5のバッチドラフトは経由しない — F6相当の
// 完了表示までこの画面が担う・wireframes-core5 §F3の保存規定どおり)。
//
// 構造要約(c8 UI磨きR0801-9d452f-ui13rendererdoc・screen-defs/obs-register-clutch.json
// はnode {type:"clutch-intake"} 1個のみでこのコンポーネントに委譲。動作影響なし):
//   種別選択 → 匹数/日付入力 → (任意)抜き取り計測 → 保存ボタン → 完了表示。
//   状態: フォーム値(種別/匹数/日付/計測値)+ 保存中フラグ+ 完了後の結果表示。
function ClutchIntakeNode() {
  const execute = useContext(ExecuteCtx);
  const navigate = useContext(NavigateCtx);
  const scope = useContext(ScopeCtx);
  const [parentMode, setParentMode] = useState<"pair" | "dam_only" | "later">("pair");
  const [sire, setSire] = useState<ParentSel>(null);
  const [dam, setDam] = useState<ParentSel>(null);
  const [species, setSpecies] = useState("");
  const [subspecies, setSubspecies] = useState("");
  const [subspeciesConfirmed, setSubspeciesConfirmed] = useState(false);
  const [harvestedAt, setHarvestedAt] = useState(() => formatDateJa(new Date()));
  const [count, setCount] = useState("");
  const [sampleOpen, setSampleOpen] = useState(false);
  const [sampleCount, setSampleCount] = useState("");
  const [sampleWeight, setSampleWeight] = useState("");
  const [containerMode, setContainerMode] = useState<"group" | "individual">("group");
  const [containerLabel, setContainerLabel] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | {
    count: number;
    avg: number | null;
    sampleCount: number | null;
  }>(null);

  const sampleN = Number(sampleCount);
  const sampleW = Number(sampleWeight);
  const avg =
    sampleCount !== "" && sampleWeight !== "" && sampleN > 0 && Number.isFinite(sampleW) ? sampleW / sampleN : null;

  useEffect(() => {
    if (parentMode !== "pair") return;
    setSpecies((s) => (s ? s : String(sire?.species ?? dam?.species ?? "")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sire, dam]);

  // R4 (OBS-R4): a scanned individual arrives as a parent candidate via
  // ?parent_id= (qr-resume hub「繁殖(クラッチ)に親として記録」→ 割り出し). Prefill
  // the sire slot once from the individual's own record so 割り出し opens with the
  // scanned bug already set as a parent (species then inherits via the effect
  // above). Best-effort: a failed lookup just leaves the picker empty — this is
  // UX prefill, not a trust path (write-time ownership is enforced server-side).
  const parentIdParam = String(scope.params.parent_id ?? "");
  useEffect(() => {
    if (!parentIdParam) return;
    let cancelled = false;
    (async () => {
      try {
        const r = (await execute({ kind: "api", method: "GET", path: `/api/v1/individuals/${parentIdParam}` })) as
          | { master?: { local_label_text?: string; species?: string } }
          | undefined;
        if (!cancelled) {
          setSire({ id: parentIdParam, label: r?.master?.local_label_text || parentIdParam, species: r?.master?.species });
        }
      } catch {
        // best-effort prefill only
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [parentIdParam, execute]);

  const submit = useCallback(async () => {
    setError(null);
    const n = Number(count);
    if (!Number.isInteger(n) || n < 0) {
      setError("匹数を正しく入力してください");
      return;
    }
    if (subspecies.trim() && !subspeciesConfirmed) {
      setError("亜種候補を確定してください([これで確定する])");
      return;
    }
    setPending(true);
    try {
      const body: Record<string, unknown> = { harvested_at: harvestedAt, initial_count: n };
      if (parentMode === "pair") {
        if (sire) body.sire_id = sire.id;
        if (dam) body.dam_id = dam.id;
      } else if (parentMode === "dam_only" && dam) {
        body.dam_id = dam.id;
      }
      if (species.trim()) body.species = species.trim();
      if (subspecies.trim()) {
        body.subspecies_candidate = subspecies.trim();
        body.subspecies_confirmed_by = "user";
      }
      if (containerMode === "group" && containerLabel.trim()) body.container_label = containerLabel.trim();
      const res = (await execute({ kind: "api", method: "POST", path: "/api/v1/clutches" }, body)) as
        | { clutch_id: string; current_count: number }
        | undefined;
      if (!res?.clutch_id) throw new Error("保存に失敗しました");
      let sampleAvg: number | null = null;
      if (avg != null) {
        await execute(
          { kind: "api", method: "POST", path: "/api/v1/observation/captures" },
          {
            domain: "biology",
            subject_ref: `clutch/${res.clutch_id}`,
            measurements: [
              { item: "weight_avg", kind: "number", value: Number(avg.toFixed(2)), unit: "g", value_origin: "aggregate" },
              { item: "weight_total", kind: "number", value: sampleW, unit: "g", value_origin: "aggregate" },
              { item: "sample_count", kind: "number", value: sampleN, unit: "匹" },
            ],
          },
        );
        sampleAvg = avg;
      }
      setDone({
        count: res.current_count ?? n,
        avg: sampleAvg,
        sampleCount: sampleAvg != null ? sampleN : null,
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }, [
    count,
    harvestedAt,
    parentMode,
    sire,
    dam,
    species,
    subspecies,
    subspeciesConfirmed,
    containerMode,
    containerLabel,
    avg,
    sampleN,
    sampleW,
    execute,
  ]);

  if (done) {
    return (
      <div className="civ-card">
        <h2 className="civ-heading" data-level="2">
          保存しました
        </h2>
        <p className="civ-text">現在 {done.count}匹</p>
        {done.avg != null && (
          <p className="civ-text" data-muted="true">
            抜き取り{done.sampleCount}匹の平均 {done.avg.toFixed(1)}g
          </p>
        )}
        <div className="civ-roster-row">
          <button
            type="button"
            className={cn("civ-interactive", "civ-button")}
            data-variant="primary"
            onClick={() => navigate("obs-register-batch")}
          >
            まとめて記録へ
          </button>
          <button
            type="button"
            className={cn("civ-interactive", "civ-button")}
            data-variant="secondary"
            onClick={() => navigate("obs-register")}
          >
            記録するへ戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="civ-form">
      <div className="civ-field">
        <span className="civ-label">親</span>
        <div className="civ-segmented" role="radiogroup" aria-label="親の指定方法">
          {(
            [
              ["pair", "♂♀を検索して指定"],
              ["dam_only", "♀のみ・父不明"],
              ["later", "親は後からリンク"],
            ] as const
          ).map(([v, l]) => (
            <label key={v} className="civ-segment">
              <input type="radio" name="parent-mode" checked={parentMode === v} onChange={() => setParentMode(v)} />
              <span>{l}</span>
            </label>
          ))}
        </div>
      </div>
      {parentMode === "pair" && (
        <>
          <ParentPicker label="父(♂)" selected={sire} onSelect={setSire} onClear={() => setSire(null)} />
          <ParentPicker label="母(♀)" selected={dam} onSelect={setDam} onClear={() => setDam(null)} />
        </>
      )}
      {parentMode === "dam_only" && (
        <ParentPicker label="母(♀)" selected={dam} onSelect={setDam} onClear={() => setDam(null)} />
      )}
      {parentMode === "later" && (
        <p className="civ-text" data-muted="true">
          親はあとから個体詳細でリンクできます。
        </p>
      )}
      <div className="civ-field">
        <label className="civ-label" htmlFor="clutch-species">
          種(任意){parentMode === "pair" && (sire || dam) ? " — 親から継承(編集可)" : ""}
        </label>
        <input
          id="clutch-species"
          className="civ-input"
          value={species}
          onChange={(e) => setSpecies(e.target.value)}
          placeholder="例: Dynastes hercules"
        />
      </div>
      <div className="civ-field">
        <label className="civ-label" htmlFor="clutch-subspecies">
          亜種候補(任意)
        </label>
        <div className="civ-picker-row">
          <input
            id="clutch-subspecies"
            className="civ-input"
            value={subspecies}
            onChange={(e) => {
              setSubspecies(e.target.value);
              setSubspeciesConfirmed(false);
            }}
            placeholder="例: hercules"
          />
          {subspecies.trim() && (
            <button
              type="button"
              className={cn("civ-interactive", "civ-button")}
              data-variant={subspeciesConfirmed ? "secondary" : "primary"}
              data-compact
              onClick={() => setSubspeciesConfirmed(true)}
            >
              {subspeciesConfirmed ? "確定済み ✓" : "これで確定する"}
            </button>
          )}
        </div>
        <p className="civ-text" data-muted="true">
          候補です — ユーザー確定のみ(自動確定はしません)。
        </p>
      </div>
      <div className="civ-field">
        <label className="civ-label" htmlFor="clutch-harvested">
          割り出し日
        </label>
        <input
          id="clutch-harvested"
          className="civ-input"
          type="date"
          value={harvestedAt}
          onChange={(e) => setHarvestedAt(e.target.value)}
        />
        <p className="civ-text" data-muted="true">
          クラッチIDは保存時に自動採番されます。
        </p>
      </div>
      <div className="civ-field">
        <label className="civ-label" htmlFor="clutch-count">
          匹数 — 今日打つ数字はこれだけ
        </label>
        <input
          id="clutch-count"
          className="civ-input"
          type="number"
          inputMode="numeric"
          value={count}
          onChange={(e) => setCount(e.target.value)}
        />
      </div>
      <div className="civ-disclosure">
        <button
          type="button"
          className={cn("civ-interactive", "civ-button", "civ-disclosure-trigger")}
          data-variant="secondary"
          aria-expanded={sampleOpen}
          onClick={() => setSampleOpen((o) => !o)}
        >
          抜き取り計測(任意) {sampleOpen ? "▾" : "▸"}
        </button>
        {sampleOpen && (
          <div className="civ-disclosure-body">
            <div className="civ-field">
              <label className="civ-label" htmlFor="sample-count">
                匹まとめて載せる
              </label>
              <input
                id="sample-count"
                className="civ-input"
                type="number"
                inputMode="numeric"
                value={sampleCount}
                onChange={(e) => setSampleCount(e.target.value)}
              />
            </div>
            <div className="civ-field">
              <label className="civ-label" htmlFor="sample-weight">
                総重量(g)
              </label>
              <input
                id="sample-weight"
                className="civ-input"
                type="number"
                inputMode="decimal"
                value={sampleWeight}
                onChange={(e) => setSampleWeight(e.target.value)}
              />
            </div>
            {avg != null && <p className="civ-text">平均 {avg.toFixed(1)}g(自動計算)</p>}
            <p className="civ-text" data-muted="true">
              クラッチの集計値として記録します(個体には割りません)。
            </p>
          </div>
        )}
      </div>
      <div className="civ-field">
        <span className="civ-label">容器</span>
        <div className="civ-segmented" role="radiogroup" aria-label="容器">
          <label className="civ-segment">
            <input
              type="radio"
              name="container-mode"
              checked={containerMode === "group"}
              onChange={() => setContainerMode("group")}
            />
            <span>まとめ置き</span>
          </label>
          <label className="civ-segment">
            <input
              type="radio"
              name="container-mode"
              checked={containerMode === "individual"}
              onChange={() => setContainerMode("individual")}
            />
            <span>個別カップに分ける</span>
          </label>
        </div>
        {containerMode === "group" && (
          <input
            className="civ-input"
            placeholder="例: 衣装ケースC-1(任意)"
            value={containerLabel}
            onChange={(e) => setContainerLabel(e.target.value)}
          />
        )}
        {containerMode === "individual" && (
          <p className="civ-text" data-muted="true">
            個別容器に分けると、その時点で個体IDが発生します。このスライスでは割り出しと同時分割はできません
            — 割り出し後に「まとめて記録」の昇格から行ってください。
          </p>
        )}
      </div>
      <p className="civ-text" data-muted="true">
        ※ 個体IDはまだ発行しません。個別容器へ分割した時に初めて発生します。
      </p>
      <button
        type="button"
        className={cn("civ-interactive", "civ-button")}
        data-variant="primary"
        aria-busy={pending || undefined}
        disabled={pending}
        onClick={submit}
      >
        確認へ →
      </button>
      {error && (
        <p role="alert" className="civ-form-error">
          {error}
        </p>
      )}
    </div>
  );
}

type IndividualRow = {
  individual_id: string;
  label: string;
  species: string | null;
  stage: string | null;
  placement_id: string | null;
  last_care_at: string | null;
  last_measurement_summary: string | null;
};
type ClutchRow = {
  clutch_id: string;
  species?: string;
  harvested_at?: string;
  current_count: number | null;
  placement_id?: string;
  container_label?: string;
};
// PlacementRowはcore/scope.tsへ一本化済み(importは冒頭)。

// F4: まとめて記録(お世話/移動一括+クラッチ照合・昇格)。GET /individuals・
// GET /clutches・GET /placements を1回ずつ取得し、クライアント側フィルタ+
// チェック選択+計測グリッドで束ね、[確認へ]でバッチドラフトを sessionStorage
// に積んで F5b(obs-register-batch-confirm)へ渡す。昇格(promote)だけは個体ID
// をその場で発行するため即時 API 呼び出し(batch-commit は promote 未対応 —
// バックエンド commit 2329559 の仕様どおり)。
// 構造要約(c8 UI磨きR0801-9d452f-ui13rendererdoc・screen-defs/obs-register-batch.json
// はnode {type:"batch-roster"} 1個のみでこのコンポーネントに委譲。動作影響なし):
//   モード切替(お世話/移動) → 3種フィルタ(棚/ステージ/最終お世話) →
//   行グリッド(選択チェック+測定入力+行メニュー) → 照合ダイアログ2種
//   (個体数照合reconcile・ステージ昇格promote) → 一括保存は次画面(batch-summary)へ。
//   状態: individuals/clutches/placements(fetch)+ mode/フィルタ3種+
//   selected行集合+grid入力値+extras(死亡/ステージ変更)+ダイアログ開閉状態。
function BatchRosterNode() {
  const execute = useContext(ExecuteCtx);
  const navigate = useContext(NavigateCtx);
  const headerScope = useContext(HeaderScopeCtx);
  const [individuals, setIndividuals] = useState<IndividualRow[]>([]);
  const [clutches, setClutches] = useState<ClutchRow[]>([]);
  const [placements, setPlacements] = useState<PlacementRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadError(null);
      try {
        // HDR-1第2スライス(A1#4): SearchNavigatorNode(obs-search)と同型 — /individuals・
        // /clutches の両方をヘッダー観測対象で絞る(/placements は物理什器なので対象外)。
        const [ind, cl, pl] = await Promise.all([
          execute({
            kind: "api",
            method: "GET",
            path: appendHeaderScope("/api/v1/individuals", headerScope),
          }) as Promise<{ individuals?: IndividualRow[] } | undefined>,
          execute({
            kind: "api",
            method: "GET",
            path: appendHeaderScope("/api/v1/clutches", headerScope),
          }) as Promise<{ clutches?: ClutchRow[] } | undefined>,
          execute({ kind: "api", method: "GET", path: "/api/v1/placements" }) as Promise<
            { placements?: PlacementRow[] } | undefined
          >,
        ]);
        if (!alive) return;
        setIndividuals((ind?.individuals ?? []).map((i) => ({ ...i, label: safeLabel(i.label, i.species) })));
        setClutches(cl?.clutches ?? []);
        setPlacements(pl?.placements ?? []);
      } catch (e) {
        if (alive) setLoadError(errorText(e));
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
    // headerScope の primitives のみを deps にする(SearchNavigatorNode と同じ規約)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headerScope.species, headerScope.lineageId, retryTick]);

  const placementLabel = useCallback(
    (id: string | null | undefined) => placements.find((p) => p.placement_id === id)?.label ?? "",
    [placements],
  );

  const [mode, setMode] = useState<"care" | "move">("care");
  const [shelfFilter, setShelfFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [careFilter, setCareFilter] = useState<"all" | "30" | "45">("all");
  const [moveTarget, setMoveTarget] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const seededRef = useRef(false);
  useEffect(() => {
    if (!loaded || seededRef.current) return;
    seededRef.current = true;
    // 検索スライスA(obs-search) ハンドオフ: sessionStorage にプリセレクトが
    // あればそれを優先(→計測グリッドへ の実体)。無ければ従来の「そろそろ」
    // 自動選択のまま(既存挙動は不変)。
    const preselect = loadPreselect();
    if (preselect) {
      setSelected(new Set(preselect));
      return;
    }
    setSelected(new Set(individuals.filter((i) => daysSince(i.last_care_at) >= OVERDUE_DAYS).map((i) => i.individual_id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const overdueCount = individuals.filter((i) => daysSince(i.last_care_at) >= OVERDUE_DAYS).length;

  const [grid, setGrid] = useState<Record<string, { weight: string; length: string }>>({});
  const setGridValue = (id: string, key: "weight" | "length", v: string) =>
    setGrid((g) => ({ ...g, [id]: { ...(g[id] ?? { weight: "", length: "" }), [key]: v } }));

  type Extra = { kind: "death"; atStage: string; weightG: string } | { kind: "lost" } | { kind: "stage"; toStage: string };
  const [extras, setExtras] = useState<Record<string, Extra>>({});
  const [rowMenuOpen, setRowMenuOpen] = useState<string | null>(null);
  const [stagePick, setStagePick] = useState<Record<string, string>>({});
  // 死亡記録の証拠収集(at_stage+terminal_observation.weight_g)。schemas/events/
  // ind-life-event.schema.json の if/then が要求する(S6コミット4d690ad)。
  const [deathStagePick, setDeathStagePick] = useState<Record<string, string>>({});
  const [deathWeightPick, setDeathWeightPick] = useState<Record<string, string>>({});

  const [reconcileOpen, setReconcileOpen] = useState<Record<string, boolean>>({});
  const [reconcileCounted, setReconcileCounted] = useState<Record<string, string>>({});
  const [reconcileQueued, setReconcileQueued] = useState<
    Record<string, { from: number; to: number; deathCount: number }>
  >({});
  const [promoteOpen, setPromoteOpen] = useState<Record<string, boolean>>({});
  const [promoteCount, setPromoteCount] = useState<Record<string, string>>({});
  const [promoted, setPromoted] = useState<Record<string, { count: number; deathCount: number }>>({});
  const [error, setError] = useState<string | null>(null);

  const filteredIndividuals = individuals.filter((i) => {
    if (shelfFilter && i.placement_id !== shelfFilter) return false;
    if (stageFilter && i.stage !== stageFilter) return false;
    if (careFilter !== "all" && daysSince(i.last_care_at) < Number(careFilter)) return false;
    return true;
  });

  const toggleRow = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const confirmReconcile = (clutchId: string, current: number) => {
    const counted = Number(reconcileCounted[clutchId] ?? current);
    if (!Number.isInteger(counted) || counted < 0) return;
    const deathCount = Math.max(0, current - counted);
    setReconcileQueued((q) => ({ ...q, [clutchId]: { from: current, to: counted, deathCount } }));
    setReconcileOpen((o) => ({ ...o, [clutchId]: false }));
  };

  // 昇格(個体ID発行)は他の一括操作(move等)と同じく、ここではローカルに
  // ステージするだけ — 実際の個体発行は確認画面の「一括保存」まで遅延する
  // (F4 での即時POSTは不可逆な個体ID発行がユーザー確認前に走ってしまうため廃止)。
  const confirmPromote = (clutchId: string, current: number) => {
    const k = Number(promoteCount[clutchId]);
    if (!Number.isInteger(k) || k <= 0 || k > current) {
      setError("昇格する数を確認してください");
      return;
    }
    setError(null);
    setPromoted((p) => ({ ...p, [clutchId]: { count: k, deathCount: 0 } }));
    setPromoteOpen((o) => ({ ...o, [clutchId]: false }));
  };

  const confirm = () => {
    const items: BatchCommitItem[] = [];
    const rows: DraftRow[] = [];
    const scheduleTargets: ScheduleTarget[] = [];
    const now = new Date().toISOString();

    if (mode === "care") {
      for (const id of selected) {
        const ind = individuals.find((i) => i.individual_id === id);
        if (!ind) continue;
        const g = grid[id] ?? { weight: "", length: "" };
        const measurements: Record<string, unknown>[] = [];
        const w = Number(g.weight);
        const l = Number(g.length);
        if (g.weight !== "" && Number.isFinite(w))
          measurements.push({ item: "weight", kind: "number", value: w, unit: "g", value_origin: "direct_observed" });
        if (g.length !== "" && Number.isFinite(l))
          measurements.push({ item: "length", kind: "number", value: l, unit: "mm", value_origin: "direct_observed" });
        const prev = ind.last_measurement_summary ? parseFloat(ind.last_measurement_summary) : null;
        const delta = prev != null && g.weight !== "" && Number.isFinite(w) ? w - prev : null;
        const idx = items.length;
        items.push({ kind: "capture", individual_id: id, body: { domain: "biology", subject_ref: `individual/${id}`, measurements } });
        rows.push({
          key: `measure-${id}`,
          group: "measure",
          label: ind.label,
          valueText: measurements.length
            ? measurements.map((m) => `${m.item === "weight" ? "体重" : "体長"} ${m.value}${m.unit}`).join(" / ")
            : "お世話のみ",
          deltaText: delta != null ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}g` : undefined,
          attention: delta != null && delta < 0,
          itemIndex: idx,
        });
        scheduleTargets.push({ individual_id: id, label: ind.label });
      }
    } else {
      if (!moveTarget) {
        setError("移動先の棚を選んでください");
        return;
      }
      for (const id of selected) {
        const ind = individuals.find((i) => i.individual_id === id);
        if (!ind) continue;
        const idx = items.length;
        items.push({ kind: "move", subject_ref: `individual/${id}`, to_placement_id: moveTarget, at: now });
        rows.push({
          key: `move-${id}`,
          group: "move",
          label: ind.label,
          valueText: `→ ${placementLabel(moveTarget) || "移動先"} へ移動`,
          itemIndex: idx,
        });
      }
    }

    for (const [id, extra] of Object.entries(extras)) {
      const ind = individuals.find((i) => i.individual_id === id);
      if (!ind) continue;
      const idx = items.length;
      if (extra.kind === "death") {
        const weight = Number(extra.weightG);
        items.push({
          kind: "life-event",
          individual_id: id,
          body: {
            kind: "death",
            at: now,
            detail: { at_stage: extra.atStage, terminal_observation: { weight_g: weight } },
          },
        });
        rows.push({
          key: `death-${id}`,
          group: "death",
          label: ind.label,
          valueText: `死亡として記録(${STAGE_LABELS_JA[extra.atStage] ?? extra.atStage}・${weight}g)`,
          itemIndex: idx,
        });
      } else if (extra.kind === "lost") {
        items.push({ kind: "life-event", individual_id: id, body: { kind: "lost", at: now } });
        rows.push({
          key: `lost-${id}`,
          group: "lost",
          label: ind.label,
          valueText: "追跡不能として記録",
          itemIndex: idx,
        });
      } else if (extra.kind === "stage") {
        items.push({ kind: "life-event", individual_id: id, body: { kind: "molt", at: now, detail: { to_stage: extra.toStage } } });
        rows.push({
          key: `stage-${id}`,
          group: "stage",
          label: ind.label,
          valueText: `→ ${STAGE_LABELS_JA[extra.toStage] ?? extra.toStage} に変化`,
          itemIndex: idx,
        });
      }
    }

    for (const [clutchId, q] of Object.entries(reconcileQueued)) {
      const cl = clutches.find((c) => c.clutch_id === clutchId);
      const idx = items.length;
      items.push({ kind: "clutch-event", clutch_id: clutchId, body: { kind: "attrition", death_count: q.deathCount, at: now, note: "匹数を照合" } });
      rows.push({
        key: `reconcile-${clutchId}`,
        group: "clutch-reconcile",
        label: cl ? `クラッチ ${cl.harvested_at ?? ""}` : "クラッチ",
        valueText: `${q.from}→${q.to}匹(死亡${q.deathCount})`,
        itemIndex: idx,
      });
    }

    for (const [clutchId, pr] of Object.entries(promoted)) {
      const cl = clutches.find((c) => c.clutch_id === clutchId);
      const idx = items.length;
      items.push({ kind: "promote", clutch_id: clutchId, count: pr.count, death_count: pr.deathCount, at: now });
      rows.push({
        key: `promote-${clutchId}`,
        group: "clutch-promote",
        label: cl ? `クラッチ ${cl.harvested_at ?? ""}` : "クラッチ",
        valueText: `${pr.count}体を昇格`,
        itemIndex: idx,
      });
    }

    if (items.length === 0 && rows.length === 0) {
      setError("対象を選択してください");
      return;
    }
    setError(null);
    saveBatchDraft({ items, rows, scheduleTargets });
    navigate("obs-register-batch-confirm");
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

  return (
    <div className="civ-form">
      {/* c8 UI磨きR0801-9d452f-ui07batchsum: モード切替・フィルタ3種・行ごとの
          測定入力・行ごとのメニュー・照合ダイアログ2種が1画面に同居するため、
          選択中の行数と次の操作を1行で先に見せる(既存の設計・自動プリセレクト
          は不変・追加は表示1行のみ)。 */}
      <p className="civ-text" data-muted="true">
        選択中 {selected.size}件・これから{mode === "care" ? "お世話" : "移動"}を記録します
      </p>
      <div className="civ-segmented" role="radiogroup" aria-label="記録の種類">
        <label className="civ-segment">
          <input type="radio" checked={mode === "care"} onChange={() => setMode("care")} />
          <span>お世話</span>
        </label>
        <label className="civ-segment">
          <input type="radio" checked={mode === "move"} onChange={() => setMode("move")} />
          <span>移動</span>
        </label>
        <button
          type="button"
          className={cn("civ-interactive", "civ-button")}
          data-variant="ghost"
          onClick={() => navigate("obs-register-clutch")}
        >
          割り出し →
        </button>
      </div>

      <div className="civ-roster-filters">
        <select className="civ-input" value={shelfFilter} onChange={(e) => setShelfFilter(e.target.value)} aria-label="棚で絞り込み">
          <option value="">棚: すべて</option>
          {placements.map((p) => (
            <option key={p.placement_id} value={p.placement_id}>
              {p.label}
            </option>
          ))}
        </select>
        <select className="civ-input" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} aria-label="ステージで絞り込み">
          <option value="">ステージ: すべて</option>
          {Object.entries(STAGE_LABELS_JA).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          className="civ-input"
          value={careFilter}
          onChange={(e) => setCareFilter(e.target.value as "all" | "30" | "45")}
          aria-label="最終お世話で絞り込み"
        >
          <option value="all">最終お世話: すべて</option>
          <option value="30">30日以上</option>
          <option value="45">45日以上</option>
        </select>
        <span className="civ-text" data-muted="true">
          該当{filteredIndividuals.length}件
        </span>
      </div>

      {overdueCount > 0 && (
        <p className="civ-text" data-muted="true">
          そろそろ: {overdueCount}件(前回から間隔が空いている子)
        </p>
      )}

      {mode === "move" && (
        <div className="civ-field">
          <label className="civ-label" htmlFor="move-target">
            移動先
          </label>
          <select id="move-target" className="civ-input" value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)}>
            <option value="">選んでください</option>
            {placements.map((p) => (
              <option key={p.placement_id} value={p.placement_id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <ul className="civ-list">
        {filteredIndividuals.map((ind) => {
          const checked = selected.has(ind.individual_id);
          const extra = extras[ind.individual_id];
          const menuOpen = rowMenuOpen === ind.individual_id;
          return (
            <li key={ind.individual_id} className="civ-roster-row">
              <label className="civ-checkbox-row">
                <input type="checkbox" checked={checked} onChange={() => toggleRow(ind.individual_id)} aria-label={`${ind.label} を選択`} />
              </label>
              <article className="civ-card">
                <div className="civ-card-head">
                  <h3 className="civ-card-title">{ind.label}</h3>
                </div>
                <div className="civ-card-badges">
                  {ind.species && <Badge text={ind.species} tone="neutral" />}
                  {ind.stage && <Badge text={STAGE_LABELS_JA[ind.stage] ?? ind.stage} tone="neutral" />}
                </div>
                <p className="civ-text" data-muted="true">
                  {ind.last_measurement_summary ? `前回 ${ind.last_measurement_summary}` : "初回"}
                  {ind.last_care_at ? `・${formatDateJa(ind.last_care_at)}` : ""}
                  {placementLabel(ind.placement_id) ? `・${placementLabel(ind.placement_id)}` : ""}
                </p>
                {extra && (
                  <p className="civ-text">
                    {extra.kind === "death"
                      ? `☠ 死亡として記録(今回・${STAGE_LABELS_JA[extra.atStage] ?? extra.atStage}・${extra.weightG}g)`
                      : extra.kind === "lost"
                        ? "🔍 追跡不能として記録(今回)"
                        : `→ ${STAGE_LABELS_JA[extra.toStage] ?? extra.toStage} に変化(今回)`}{" "}
                    <button
                      type="button"
                      className={cn("civ-interactive", "civ-button")}
                      data-variant="ghost"
                      data-compact
                      onClick={() =>
                        setExtras((e) => {
                          const n = { ...e };
                          delete n[ind.individual_id];
                          return n;
                        })
                      }
                    >
                      取消
                    </button>
                  </p>
                )}
                {!extra && (
                  <button
                    type="button"
                    className={cn("civ-interactive", "civ-button")}
                    data-variant="ghost"
                    data-compact
                    aria-expanded={menuOpen}
                    onClick={() => setRowMenuOpen(menuOpen ? null : ind.individual_id)}
                  >
                    ⋯ 死亡・ステージ変化
                  </button>
                )}
                {menuOpen && !extra && (
                  <div className="civ-disclosure-body">
                    <div className="civ-picker-row">
                      <select
                        className="civ-input"
                        value={deathStagePick[ind.individual_id] ?? ""}
                        onChange={(e) => setDeathStagePick((s) => ({ ...s, [ind.individual_id]: e.target.value }))}
                        aria-label="死亡時のステージ"
                      >
                        <option value="">死亡時のステージ</option>
                        {Object.entries(STAGE_LABELS_JA).map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        className="civ-input"
                        placeholder="体重(g)"
                        aria-label="死亡時の体重(g)"
                        value={deathWeightPick[ind.individual_id] ?? ""}
                        onChange={(e) => setDeathWeightPick((s) => ({ ...s, [ind.individual_id]: e.target.value }))}
                      />
                      <button
                        type="button"
                        className={cn("civ-interactive", "civ-button")}
                        data-variant="secondary"
                        disabled={
                          !deathStagePick[ind.individual_id] ||
                          !Number.isFinite(Number(deathWeightPick[ind.individual_id])) ||
                          deathWeightPick[ind.individual_id] === ""
                        }
                        onClick={() => {
                          const atStage = deathStagePick[ind.individual_id];
                          const weightG = deathWeightPick[ind.individual_id];
                          if (!atStage || !weightG) return;
                          setExtras((e) => ({ ...e, [ind.individual_id]: { kind: "death", atStage, weightG } }));
                          setRowMenuOpen(null);
                        }}
                      >
                        ☠ 死亡として記録
                      </button>
                      <button
                        type="button"
                        className={cn("civ-interactive", "civ-button")}
                        data-variant="secondary"
                        onClick={() => {
                          setExtras((e) => ({ ...e, [ind.individual_id]: { kind: "lost" } }));
                          setRowMenuOpen(null);
                        }}
                      >
                        🔍 追跡不能として記録
                      </button>
                    </div>
                    <div className="civ-picker-row">
                      <select
                        className="civ-input"
                        value={stagePick[ind.individual_id] ?? ""}
                        onChange={(e) => setStagePick((s) => ({ ...s, [ind.individual_id]: e.target.value }))}
                        aria-label="次のステージ"
                      >
                        <option value="">ステージを選ぶ</option>
                        {Object.entries(STAGE_LABELS_JA).map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className={cn("civ-interactive", "civ-button")}
                        data-variant="secondary"
                        disabled={!stagePick[ind.individual_id]}
                        onClick={() => {
                          const toStage = stagePick[ind.individual_id];
                          if (!toStage) return;
                          setExtras((e) => ({ ...e, [ind.individual_id]: { kind: "stage", toStage } }));
                          setRowMenuOpen(null);
                        }}
                      >
                        記録
                      </button>
                    </div>
                  </div>
                )}
              </article>
            </li>
          );
        })}
        {clutches.map((cl) => {
          const current = cl.current_count ?? 0;
          const queued = reconcileQueued[cl.clutch_id];
          const promotedResult = promoted[cl.clutch_id];
          const effectiveCurrent = queued ? queued.to : current;
          return (
            <li key={cl.clutch_id} className="civ-roster-row">
              <span aria-hidden="true" />
              <article className="civ-card">
                <div className="civ-card-head">
                  <span className="civ-card-icon" aria-hidden="true">
                    🥚
                  </span>
                  <h3 className="civ-card-title">クラッチ {cl.harvested_at ?? ""}</h3>
                </div>
                <div className="civ-card-badges">
                  {cl.species && <Badge text={cl.species} tone="neutral" />}
                  <Badge text={`残${effectiveCurrent}匹`} tone="neutral" />
                </div>
                {(placementLabel(cl.placement_id) || cl.container_label) && (
                  <p className="civ-text" data-muted="true">
                    {[placementLabel(cl.placement_id), cl.container_label].filter(Boolean).join("・")}
                  </p>
                )}
                {queued && (
                  <p className="civ-text">
                    匹数を照合済み: {queued.from}→{queued.to}匹(死亡{queued.deathCount})
                  </p>
                )}
                {promotedResult && <p className="civ-text">{promotedResult.count}体を個体化しました</p>}
                <div className="civ-roster-row">
                  <button
                    type="button"
                    className={cn("civ-interactive", "civ-button")}
                    data-variant="secondary"
                    data-compact
                    onClick={() => {
                      setReconcileOpen((o) => ({ ...o, [cl.clutch_id]: !o[cl.clutch_id] }));
                      setReconcileCounted((c) => ({ ...c, [cl.clutch_id]: c[cl.clutch_id] ?? String(current) }));
                    }}
                  >
                    匹数を照合…
                  </button>
                  <button
                    type="button"
                    className={cn("civ-interactive", "civ-button")}
                    data-variant="secondary"
                    data-compact
                    disabled={!!promotedResult}
                    onClick={() => setPromoteOpen((o) => ({ ...o, [cl.clutch_id]: !o[cl.clutch_id] }))}
                  >
                    個別容器へ分割(昇格)…
                  </button>
                </div>
                {reconcileOpen[cl.clutch_id] && (
                  <div className="civ-disclosure-body">
                    <p className="civ-text" data-muted="true">
                      現在のカウント: {current}匹
                    </p>
                    <div className="civ-field">
                      <label className="civ-label" htmlFor={`recount-${cl.clutch_id}`}>
                        今日数えた数
                      </label>
                      <input
                        id={`recount-${cl.clutch_id}`}
                        className="civ-input"
                        type="number"
                        inputMode="numeric"
                        value={reconcileCounted[cl.clutch_id] ?? ""}
                        onChange={(e) => setReconcileCounted((c) => ({ ...c, [cl.clutch_id]: e.target.value }))}
                      />
                    </div>
                    <button
                      type="button"
                      className={cn("civ-interactive", "civ-button")}
                      data-variant="primary"
                      data-compact
                      onClick={() => confirmReconcile(cl.clutch_id, current)}
                    >
                      確認へ積む
                    </button>
                  </div>
                )}
                {promoteOpen[cl.clutch_id] && (
                  <div className="civ-disclosure-body">
                    <p className="civ-text" data-muted="true">
                      現在のカウント: {effectiveCurrent}匹
                    </p>
                    <div className="civ-field">
                      <label className="civ-label" htmlFor={`promote-${cl.clutch_id}`}>
                        今日カップに分けた数
                      </label>
                      <input
                        id={`promote-${cl.clutch_id}`}
                        className="civ-input"
                        type="number"
                        inputMode="numeric"
                        value={promoteCount[cl.clutch_id] ?? ""}
                        onChange={(e) => setPromoteCount((c) => ({ ...c, [cl.clutch_id]: e.target.value }))}
                      />
                    </div>
                    <p className="civ-text" data-muted="true">
                      種・血統・孵化日はクラッチから継承します(確認のみ)。
                    </p>
                    <button
                      type="button"
                      className={cn("civ-interactive", "civ-button")}
                      data-variant="primary"
                      data-compact
                      onClick={() => confirmPromote(cl.clutch_id, effectiveCurrent)}
                    >
                      昇格する
                    </button>
                  </div>
                )}
              </article>
            </li>
          );
        })}
      </ul>

      {mode === "care" && selected.size > 0 && (
        // wave-1批評指摘: 390px幅では横スクロールでなくラベル付きカード積みに
        // する(入力表なので列見出しがスクロールで隠れると何を打っているか
        // わからなくなる)。civ-care-table のみに閉じたスコープの mobile CSS
        // (globals.css)。data-label は各 th と同一文言で td::before に出す。
        <table className={cn("civ-table", "civ-care-table")}>
          <thead>
            <tr>
              <th>個体</th>
              <th>体重g</th>
              <th>体長mm</th>
              <th>Δ前回</th>
            </tr>
          </thead>
          <tbody>
            {[...selected].map((id) => {
              const ind = individuals.find((i) => i.individual_id === id);
              if (!ind) return null;
              const g = grid[id] ?? { weight: "", length: "" };
              const prev = ind.last_measurement_summary ? parseFloat(ind.last_measurement_summary) : null;
              const w = Number(g.weight);
              const delta = prev != null && g.weight !== "" && Number.isFinite(w) ? w - prev : null;
              return (
                <tr key={id}>
                  <td className="civ-cell-clip" data-label="個体" title={ind.label}>
                    {ind.label}
                  </td>
                  <td data-label="体重g">
                    <input
                      className="civ-input"
                      type="number"
                      inputMode="decimal"
                      value={g.weight}
                      onChange={(e) => setGridValue(id, "weight", e.target.value)}
                      aria-label={`${ind.label} 体重g`}
                    />
                  </td>
                  <td data-label="体長mm">
                    <input
                      className="civ-input"
                      type="number"
                      inputMode="decimal"
                      value={g.length}
                      onChange={(e) => setGridValue(id, "length", e.target.value)}
                      aria-label={`${ind.label} 体長mm`}
                    />
                  </td>
                  <td data-label="Δ前回">{delta != null ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}g` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <button type="button" className={cn("civ-interactive", "civ-button")} data-variant="primary" onClick={confirm}>
        確認へ →
      </button>
      {error && (
        <p role="alert" className="civ-form-error">
          {error}
        </p>
      )}
    </div>
  );
}

const BATCH_GROUP_LABELS: Record<BatchGroup, string> = {
  measure: "計測",
  move: "移動",
  death: "死亡",
  lost: "追跡不能",
  stage: "ステージ変化",
  "clutch-reconcile": "クラッチ照合",
  "clutch-promote": "クラッチ昇格",
};

// F5b: バッチ確認。種別ごとの1行サマリ+注意行(Δマイナス)だけ個別表示。
// [N件を一括保存] = POST /observation/batch-commit のあと(オプトインなら)
// scheduleTargets を個体ごと POST /observation/schedule(best-effort)。
function BatchSummaryNode() {
  const execute = useContext(ExecuteCtx);
  const navigate = useContext(NavigateCtx);
  // sessionStorage は SSR 時に window が無く常に null を返す。マウント前の
  // 初回クライアント render は SSR と一致させる必要がある(hydration mismatch
  // 回避)ため、読み込みは useEffect に移し BatchRosterNode と同じ
  // 「読み込み中…」ゲートを挟む(F5b/F6b で Next.js dev の 1 Issue バッジが
  // 出ていた根本原因)。
  const [draft, setDraft] = useState<BatchDraft | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setDraft(loadBatchDraft());
    setLoaded(true);
  }, []);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [registerSchedule, setRegisterSchedule] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loaded) {
    return (
      <p className="civ-text" data-muted="true">
        読み込み中…
      </p>
    );
  }

  if (!draft || (draft.items.length === 0 && draft.rows.length === 0)) {
    return (
      <div className="civ-card">
        <p className="civ-text" data-muted="true">
          保存する内容がありません。まとめて記録からやり直してください。
        </p>
        <button
          type="button"
          className={cn("civ-interactive", "civ-button")}
          data-variant="secondary"
          onClick={() => navigate("obs-register-batch")}
        >
          まとめて記録へ戻る
        </button>
      </div>
    );
  }

  const counts: Partial<Record<BatchGroup, number>> = {};
  for (const r of draft.rows) counts[r.group] = (counts[r.group] ?? 0) + 1;
  const attentionRows = draft.rows.filter((r) => r.attention && !dismissed.has(r.key));

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      const res = (await execute(
        { kind: "api", method: "POST", path: "/api/v1/observation/batch-commit" },
        { items: draft.items },
      )) as { results?: BatchResult[] } | undefined;
      const results = res?.results ?? [];
      let scheduledAt: string | undefined;
      if (registerSchedule && draft.scheduleTargets.length > 0) {
        let scheduledCount = 0;
        for (const t of draft.scheduleTargets) {
          try {
            // F6 単発フロー(obs-register-done.json)と同じ body 形(template は
            // ネストしたオブジェクト — ドット付きキーは FormNode 経由の submit
            // でのみ setPath される規約。ここは execute() を直接呼ぶので自分で
            // ネストする必要がある)。
            await execute(
              { kind: "api", method: "POST", path: "/api/v1/observation/schedule" },
              {
                individual_id: t.individual_id,
                stage: "unspecified",
                from: new Date().toISOString(),
                template: { stage_interval_days: { unspecified: 30 } },
              },
            );
            scheduledCount += 1;
          } catch {
            // best-effort — 1件の失敗で他個体の登録を止めない(部分失敗を隠さない
            // のは batch-commit 側の results で担保、schedule は事後の付随処理)。
          }
        }
        // 誇張ゼロ: 1件も成功しなければ「登録済み」と表示しない。
        if (scheduledCount > 0) scheduledAt = formatDateJa(todayPlusDays(30));
      }
      saveBatchResults({ results, scheduledAt });
      navigate("obs-register-batch-done");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="civ-form">
      <div className="civ-list">
        {(Object.keys(BATCH_GROUP_LABELS) as BatchGroup[])
          .filter((g) => counts[g])
          .map((g) => (
            <p key={g} className="civ-text">
              ✓ {BATCH_GROUP_LABELS[g]} {counts[g]}件
            </p>
          ))}
      </div>
      {attentionRows.length > 0 && (
        <div className="civ-list">
          <p className="civ-text" data-muted="true">
            この{attentionRows.length}件だけ見てください
          </p>
          {attentionRows.map((r) => (
            <article key={r.key} className="civ-card">
              <p className="civ-text">
                {r.label} {r.valueText} {r.deltaText}
              </p>
              <div className="civ-roster-row">
                <button
                  type="button"
                  className={cn("civ-interactive", "civ-button")}
                  data-variant="secondary"
                  data-compact
                  onClick={() => setDismissed((d) => new Set(d).add(r.key))}
                >
                  OKこのまま
                </button>
                <button
                  type="button"
                  className={cn("civ-interactive", "civ-button")}
                  data-variant="ghost"
                  data-compact
                  onClick={() => navigate("obs-register-batch")}
                >
                  測り直す
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      <label className="civ-checkbox-row" htmlFor="batch-register-schedule">
        <input
          id="batch-register-schedule"
          type="checkbox"
          checked={registerSchedule}
          onChange={(e) => setRegisterSchedule(e.target.checked)}
        />
        <span className="civ-label">次の観測目安を自動設定</span>
      </label>
      <button
        type="button"
        className={cn("civ-interactive", "civ-button")}
        data-variant="primary"
        aria-busy={pending || undefined}
        disabled={pending}
        onClick={save}
      >
        {draft.items.length}件を一括保存
      </button>
      {error && (
        <p role="alert" className="civ-form-error">
          {error}
        </p>
      )}
    </div>
  );
}

// F6b: バッチ保存後の完了表示。行ごとの Δ + クラッチ結果(照合/昇格・すでに
// 直接コミット済みの行も表示)+ 次の観測目安の事後表示。部分失敗(batch-commit の
// results に error)があれば行ごとに「保存できませんでした」を表示する
// (部分失敗を隠さない)。
function BatchDoneNode() {
  const navigate = useContext(NavigateCtx);
  // BatchSummaryNode と同じ理由(hydration mismatch 回避)で sessionStorage
  // 読み込みは useEffect に移す。
  const [draft, setDraft] = useState<BatchDraft | null>(null);
  const [results, setResults] = useState<BatchResults | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setDraft(loadBatchDraft());
    setResults(loadBatchResults());
    setLoaded(true);
  }, []);

  if (!loaded) {
    return (
      <p className="civ-text" data-muted="true">
        読み込み中…
      </p>
    );
  }

  if (!draft || !results) {
    return (
      <div className="civ-card">
        <p className="civ-text" data-muted="true">
          保存結果がありません。
        </p>
        <button
          type="button"
          className={cn("civ-interactive", "civ-button")}
          data-variant="secondary"
          onClick={() => {
            clearBatch();
            navigate("home");
          }}
        >
          ホームへ
        </button>
      </div>
    );
  }

  const measureCount = draft.rows.filter((r) => r.group === "measure").length;

  return (
    <div className="civ-form">
      <ul className="civ-list">
        {draft.rows.map((r) => {
          const result = r.itemIndex != null ? results.results[r.itemIndex] : undefined;
          const failed = result != null && result.ok === false;
          return (
            <li key={r.key}>
              <article className="civ-card">
                {failed ? (
                  <p className="civ-text">
                    {r.label}: 保存できませんでした({mapError((result as { ok: false; error: string }).error)})
                  </p>
                ) : (
                  <div className="civ-card-badges">
                    <span className="civ-text">
                      {r.label} {r.valueText}
                    </span>
                    {r.deltaText && <Badge text={r.deltaText} tone={r.attention ? "caution" : "success"} />}
                  </div>
                )}
              </article>
            </li>
          );
        })}
      </ul>
      {results.scheduledAt && measureCount > 0 && (
        <p className="civ-text">
          ✓ 次の観測目安 設定済み — {measureCount}件 → {results.scheduledAt} 頃(間隔30日)
        </p>
      )}
      <div className="civ-roster-row">
        <button
          type="button"
          className={cn("civ-interactive", "civ-button")}
          data-variant="secondary"
          onClick={() => {
            clearBatch();
            navigate("obs-register-batch");
          }}
        >
          同じ条件でもう一度
        </button>
        <button
          type="button"
          className={cn("civ-interactive", "civ-button")}
          data-variant="primary"
          onClick={() => {
            clearBatch();
            navigate("home");
          }}
        >
          完了
        </button>
      </div>
    </div>
  );
}

registerNode("clutch-intake", ClutchIntakeNode);
registerNode("batch-roster", BatchRosterNode);
registerNode("batch-summary", BatchSummaryNode);
registerNode("batch-done", BatchDoneNode);
