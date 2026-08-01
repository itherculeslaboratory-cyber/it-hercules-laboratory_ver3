"use client";

import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { DataSinkCtx, ExecuteCtx, HeaderScopeCtx, NavigateCtx, ScopeCtx } from "../core/context";
import {
  appendHeaderScope,
  errorText,
  formatDateJa,
  getPath,
  interpolate,
  STAGE_LABELS_JA,
  safeLabel,
  type PlacementRow,
} from "../core/scope";
import { savePreselect } from "../batch-draft";
import { registerNode } from "../core/registry";
import { Badge } from "../core/primitives";
import { useSource } from "../core/node-view";
import type { ScreenNode } from "../types";
import {
  type IndividualProfile,
  type PedNode,
  type ProfileCapture,
  type ProfileMeasurement,
  type TimelineEntry,
  buildTimeline,
  collectAncestors,
  inbreedingCoefficient,
  inbreedingTone,
  isDegenerate,
  measureValue,
  prevValueFn,
  profileLabel,
  seriesFor,
} from "../core/individual";

// Phase 2b裁定(g85-split2a-ruling §3)でSTAGE_LABELS_JA/safeLabel/PlacementRow/
// Badge/IndividualProfile系はcore側へ一本化済み(このゾーンのローカル複製は解消)。

// =============================================================================
// V3-AIP-101 個体詳細スライスA (c7-wireframes-core5 §4 F1/F2) — growth-chart
// (手書き SVG 折れ線・依存追加なし) + individual-profile(ヘッダ/血統健全度・
// 近交リスクチップ/血縁レール/変化点タイムライン/sticky下端バーを1画面に持つ
// 専用ノード。GET /individuals/{id}/profile + /pedigree を自前取得する —
// search-navigator/batch-summary と同じ縮退)。
// =============================================================================

// Profile*/IndividualProfile/PedNode/profileLabel/measureValue/seriesFor/
// isDegenerateはPhase 2b裁定(g85-split2a-ruling §3 #6)でcore/individual.tsへ
// 一本化済み(importは冒頭)。

const CHART_UNITS = [
  { value: "weight", label: "体重(g)" },
  { value: "length", label: "体長(mm)" },
] as const;
type ChartUnit = (typeof CHART_UNITS)[number]["value"];
const CHART_UNIT_SUFFIX: Record<ChartUnit, string> = { weight: "g", length: "mm" };
// axis labels stay short (小さく) — round to 1 decimal only when needed.
const fmtAxisVal = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(1));

// V3-AIP-101 新レンダラ部品 growth-chart: 本個体実線+親破線オーバーレイ+
// コホート(兄弟)min-max帯を手書き SVG で描く(チャートライブラリ非依存)。
// 親カーブ欠損(購入個体等 [訂正8])はⓘ帯+親リンクの小フォームを内包し、
// エラーではなく第一級の正常状態として描く。でっち上げの「同種標準帯」は
// 実データが無いため描かない(誇張ゼロ)。
function GrowthChartView({ profile, onLinked }: { profile: IndividualProfile; onLinked: () => void }) {
  const execute = useContext(ExecuteCtx);
  const [unit, setUnit] = useState<ChartUnit>("weight");
  const [linkOpen, setLinkOpen] = useState(false);
  const [sireId, setSireId] = useState("");
  const [damId, setDamId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const degenerate = isDegenerate([
    profile.observations,
    profile.parent_observations.sire,
    profile.parent_observations.dam,
  ]);
  const own = seriesFor(profile.observations, unit, degenerate);
  const sire = seriesFor(profile.parent_observations.sire, unit, degenerate);
  const dam = seriesFor(profile.parent_observations.dam, unit, degenerate);
  const cohortValues = profile.cohort_observations
    .map((o) => (unit === "weight" ? o.weight_g : o.length_mm))
    .filter((v): v is number => v != null);
  // コホート帯は3点以上の実データがある時だけ(でっち上げの基準帯を描かない)。
  const cohortBand: [number, number] | null =
    cohortValues.length >= 3 ? [Math.min(...cohortValues), Math.max(...cohortValues)] : null;
  const noParentLink = !profile.parents.sire && !profile.parents.dam;

  const allY = [...own, ...sire, ...dam].map((pt) => pt.y).concat(cohortBand ?? []);
  const maxX = Math.max(1, ...[...own, ...sire, ...dam].map((pt) => pt.x));
  // fix#2(磨き直し): axis hints need the REAL data min/max (not baselined at 0)
  // so the two small numbers at the left edge mean something ("45g"/"120g").
  // A little headroom (8%) keeps points off the very edge of the plot.
  const rawMin = allY.length ? Math.min(...allY) : null;
  const rawMax = allY.length ? Math.max(...allY) : null;
  const yPad = rawMin != null && rawMax != null ? (rawMax - rawMin) * 0.08 || Math.max(1, rawMax * 0.1) : 1;
  const yMin = rawMin != null ? rawMin - yPad : 0;
  const yMax = rawMax != null ? rawMax + yPad : 1;
  const unitSuffix = CHART_UNIT_SUFFIX[unit];
  const W = 320;
  const H = 160;
  const PAD_L = 28; // room for the y-axis min/max labels at the left edge
  const PAD_R = 8;
  const PAD_T = 12; // room for the top (max) label
  const PAD_B = 16; // room for the x-axis date labels
  const px = (x: number) => PAD_L + (x / maxX) * (W - PAD_L - PAD_R);
  const py = (y: number) => H - PAD_B - ((y - yMin) / (yMax - yMin || 1)) * (H - PAD_T - PAD_B);
  const pathOf = (pts: { x: number; y: number }[]) =>
    pts.map((pt, i) => `${i === 0 ? "M" : "L"}${px(pt.x).toFixed(1)},${py(pt.y).toFixed(1)}`).join(" ");
  // 最大3本の水平グリッド線(上端・中央・下端) — 親破線が「宙に浮いて見える」
  // 問題を、目盛りの手がかりで解消する(fix#2)。
  const gridYs = [PAD_T, (PAD_T + (H - PAD_B)) / 2, H - PAD_B];

  const submitLink = async () => {
    if (!sireId.trim() && !damId.trim()) return;
    setPending(true);
    setError(null);
    try {
      if (sireId.trim()) {
        await execute(
          { kind: "api", method: "POST", path: `/api/v1/individuals/${profile.individual_id}/parents` },
          { parent_id: sireId.trim(), parent_role: "sire" },
        );
      }
      if (damId.trim()) {
        await execute(
          { kind: "api", method: "POST", path: `/api/v1/individuals/${profile.individual_id}/parents` },
          { parent_id: damId.trim(), parent_role: "dam" },
        );
      }
      onLinked();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="civ-growth-chart">
      <div className="civ-segmented" role="radiogroup" aria-label="表示単位">
        {CHART_UNITS.map((u) => (
          <label key={u.value} className="civ-segment">
            <input type="radio" checked={unit === u.value} onChange={() => setUnit(u.value)} />
            <span>{u.label}</span>
          </label>
        ))}
      </div>

      {noParentLink && (
        <div className="civ-info-banner">
          <p className="civ-text">ⓘ 親データ無し — 親をリンクすると比較が始まります。</p>
          <button
            type="button"
            className={cn("civ-interactive", "civ-button")}
            data-variant="ghost"
            data-compact
            aria-expanded={linkOpen}
            onClick={() => setLinkOpen((o) => !o)}
          >
            親をリンク {linkOpen ? "▾" : "▸"}
          </button>
          {linkOpen && (
            <div className="civ-disclosure-body">
              <div className="civ-field">
                <label className="civ-label" htmlFor="chart-sire-id">
                  親♂の個体ID(任意)
                </label>
                <input
                  id="chart-sire-id"
                  className="civ-input"
                  value={sireId}
                  onChange={(e) => setSireId(e.target.value)}
                />
              </div>
              <div className="civ-field">
                <label className="civ-label" htmlFor="chart-dam-id">
                  親♀の個体ID(任意)
                </label>
                <input
                  id="chart-dam-id"
                  className="civ-input"
                  value={damId}
                  onChange={(e) => setDamId(e.target.value)}
                />
              </div>
              <button
                type="button"
                className={cn("civ-interactive", "civ-button")}
                data-variant="primary"
                data-compact
                data-loading={pending || undefined}
                disabled={pending}
                onClick={submitLink}
              >
                リンクする
              </button>
              {error && (
                <span role="alert" className="civ-field-error">
                  {error}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {own.length === 0 ? (
        <p className="civ-empty">まだ観測がありません</p>
      ) : own.length === 1 ? (
        // fix#5(磨き直し): 点1つ+広い空白の代わりに、小さい枠+点の下の1行に留める。
        <div className="civ-growth-chart-single">
          <svg className="civ-growth-chart-svg" viewBox={`0 0 ${W} 56`} role="img" aria-label="成長曲線(観測1回)">
            <circle cx={W / 2} cy={28} r={3} fill="var(--civ-primary)" />
            <text x={W / 2 + 8} y={32} className="civ-chart-axis-label">
              {fmtAxisVal(own[0].y)}
              {unitSuffix}
            </text>
          </svg>
          <p className="civ-text" data-muted="true">
            観測1回 — 2回目からカーブになります
          </p>
        </div>
      ) : (
        <>
          <svg className="civ-growth-chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="成長曲線">
            {gridYs.map((gy, i) => (
              <line key={i} x1={PAD_L} x2={W - PAD_R} y1={gy} y2={gy} stroke="var(--civ-border)" strokeWidth="1" />
            ))}
            {cohortBand && (
              <rect
                x={PAD_L}
                y={py(cohortBand[1])}
                width={W - PAD_L - PAD_R}
                height={Math.max(1, py(cohortBand[0]) - py(cohortBand[1]))}
                fill="var(--civ-surface-2)"
              />
            )}
            {sire.length > 0 && (
              <path d={pathOf(sire)} fill="none" stroke="var(--civ-text-muted)" strokeWidth="1.5" strokeDasharray="6 3" />
            )}
            {dam.length > 0 && (
              <path d={pathOf(dam)} fill="none" stroke="var(--civ-text-muted)" strokeWidth="1.5" strokeDasharray="2 2" />
            )}
            <path d={pathOf(own)} fill="none" stroke="var(--civ-primary)" strokeWidth="2" />
            {own.map((pt, i) => (
              <circle key={i} cx={px(pt.x)} cy={py(pt.y)} r={2.5} fill="var(--civ-primary)" />
            ))}
            {/* fix#2(磨き直し): Y軸min/max・X軸最初/最後の観測日を小さく添える。 */}
            {rawMax != null && (
              <text x={2} y={py(rawMax) + 3} className="civ-chart-axis-label">
                {fmtAxisVal(rawMax)}
                {unitSuffix}
              </text>
            )}
            {rawMin != null && (
              <text x={2} y={py(rawMin) + 3} className="civ-chart-axis-label">
                {fmtAxisVal(rawMin)}
                {unitSuffix}
              </text>
            )}
            <text x={px(own[0].x)} y={H - 2} className="civ-chart-axis-label" textAnchor="start">
              {formatDateJa(own[0].iso)}
            </text>
            <text x={px(own[own.length - 1].x)} y={H - 2} className="civ-chart-axis-label" textAnchor="end">
              {formatDateJa(own[own.length - 1].iso)}
            </text>
          </svg>
          <div className="civ-chip-row">
            <span className="civ-text" data-muted="true">
              ● 本個体
            </span>
            {sire.length > 0 && (
              <span className="civ-text" data-muted="true">
                ┄┄ 親♂
              </span>
            )}
            {dam.length > 0 && (
              <span className="civ-text" data-muted="true">
                ┈┈ 親♀
              </span>
            )}
            {cohortBand && (
              <span className="civ-text" data-muted="true">
                ▧ 同腹帯(n={cohortValues.length})
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// 標準の source_path 自前取得ラッパー(単独 screen-def ノードとしても宣言可能)。
// individual-profile から使う時は data を直接渡す(GrowthChartView 参照)ので
// 二重取得しない。
function GrowthChartNode({ node }: { node: ScreenNode }) {
  useSource(node);
  const scope = useContext(ScopeCtx);
  const navigate = useContext(NavigateCtx);
  const profile = getPath(scope, `data.${node.id}`) as IndividualProfile | undefined;
  if (!profile) {
    return (
      <p className="civ-text" data-muted="true">
        読み込み中…
      </p>
    );
  }
  return (
    <GrowthChartView
      profile={profile}
      onLinked={() => navigate("individual-detail", { id: profile.individual_id })}
    />
  );
}

// Wright の近交係数 F = Σ (1/2)^(n1+n2+1)・(1+F_A)。共通祖先自身の近交係数
// F_A はこのスライスでは 0 と仮定する簡易版(ponytail: 祖先の近交まで遡ると
// 要件の「深さ4世代」を超えて再帰することになり過剰実装 — 精密版が要るなら
// 別途要件化してから)。深さは sire/dam=世代1 として祖先3世代先(計4世代)まで。
// collectAncestors/inbreedingCoefficient/inbreedingToneはPhase 2b裁定(g85-
// split2a-ruling §3 #6)でcore/individual.tsへ一本化済み(importは冒頭)。

// 血統健全度(同腹N匹・死亡率・羽化到達率)。siblings が空(単体登録・購入個体)
// なら算出母数が無いので null(「同腹集計なし」の第一級表示に回す)。
// fix#4(磨き直し): 死亡率に良し悪し語を添える(羽化到達は語なし)。母数5未満
// は smallSample フラグで「(母数小)」を誠実に併記する。
function computeHealth(profile: IndividualProfile) {
  if (profile.siblings.length === 0) return null;
  const cohortSize = profile.siblings.length + 1;
  const selfEclosed = profile.life_events.some((e) => e.kind === "eclosion");
  const deathCount = profile.siblings.filter((s) => s.dead).length + (profile.status === "deceased" ? 1 : 0);
  const eclosionCount = profile.siblings.filter((s) => s.eclosed).length + (selfEclosed ? 1 : 0);
  const deathPct = Math.round((deathCount / cohortSize) * 100);
  const deathTone =
    deathPct < 10 ? { symbol: "●", word: "良" } : deathPct < 30 ? { symbol: "▲", word: "注意" } : { symbol: "⚠", word: "高" };
  return {
    cohortSize,
    deathCount,
    deathPct,
    deathTone,
    eclosionCount,
    eclosionPct: Math.round((eclosionCount / cohortSize) * 100),
    smallSample: cohortSize < 5,
  };
}

// ●badge▾メニュー(死亡記録+QR再発行)。確認は既存 death-toggle と同じ「必須
// チェックボックス+ボタン」の流儀(ネイティブ confirm() は使わない・指摘6)。
function StatusMenu({ profile, onChanged }: { profile: IndividualProfile; onChanged: () => void }) {
  const execute = useContext(ExecuteCtx);
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cohortSize = profile.siblings.length + 1;
  // 死亡記録の証拠収集(at_stage+terminal_observation.weight_g)。schemas/events/
  // ind-life-event.schema.json の if/then が要求する(S6コミット4d690ad)。
  const [atStage, setAtStage] = useState(profile.stage ?? "");
  const [weightG, setWeightG] = useState("");
  const weightGValid = weightG !== "" && Number.isFinite(Number(weightG));

  const recordDeath = async () => {
    if (!confirmed || !atStage || !weightGValid) return;
    setPending(true);
    setError(null);
    try {
      await execute(
        { kind: "api", method: "POST", path: `/api/v1/individuals/${profile.individual_id}/life-events` },
        {
          kind: "death",
          at: new Date().toISOString(),
          detail: { at_stage: atStage, terminal_observation: { weight_g: Number(weightG) } },
        },
      );
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  };
  const reissueQr = async () => {
    setPending(true);
    setError(null);
    try {
      await execute({ kind: "api", method: "POST", path: `/api/v1/individuals/${profile.individual_id}/qr` });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  };
  // lost はdetail必須なし(ind-life-event.schema.jsonのif/thenはkind:"death"のみ対象)。
  const recordLost = async () => {
    setPending(true);
    setError(null);
    try {
      await execute(
        { kind: "api", method: "POST", path: `/api/v1/individuals/${profile.individual_id}/life-events` },
        { kind: "lost", at: new Date().toISOString() },
      );
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="civ-disclosure" data-open={open || undefined}>
      <button
        type="button"
        className={cn("civ-interactive", "civ-badge", "civ-disclosure-trigger")}
        data-tone={profile.status === "deceased" ? "neutral" : "success"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {profile.status === "deceased" ? "●死亡" : "●飼育中"} {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="civ-disclosure-body">
          {profile.status !== "deceased" && (
            <div className="civ-field">
              <label className="civ-label" htmlFor={`death-at-stage-${profile.individual_id}`}>
                死亡時のステージ
              </label>
              <select
                id={`death-at-stage-${profile.individual_id}`}
                className="civ-input"
                value={atStage}
                onChange={(e) => setAtStage(e.target.value)}
              >
                <option value="">選んでください</option>
                {Object.entries(STAGE_LABELS_JA).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <label className="civ-label" htmlFor={`death-weight-${profile.individual_id}`}>
                死亡時の体重(g)
              </label>
              <input
                id={`death-weight-${profile.individual_id}`}
                type="number"
                className="civ-input"
                value={weightG}
                onChange={(e) => setWeightG(e.target.value)}
              />
              <label className="civ-checkbox-row">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span className="civ-label">
                  死亡として記録することを確認しました(同腹{cohortSize}匹の集計母数が変わります。記録の削除はできません)
                </span>
              </label>
              <button
                type="button"
                className={cn("civ-interactive", "civ-button")}
                data-variant="secondary"
                data-compact
                disabled={!confirmed || !atStage || !weightGValid || pending}
                onClick={recordDeath}
              >
                死亡を記録する
              </button>
              <button
                type="button"
                className={cn("civ-interactive", "civ-button")}
                data-variant="ghost"
                data-compact
                disabled={pending}
                onClick={recordLost}
              >
                🔍 追跡不能として記録
              </button>
            </div>
          )}
          <button
            type="button"
            className={cn("civ-interactive", "civ-button")}
            data-variant="ghost"
            data-compact
            disabled={pending}
            onClick={reissueQr}
          >
            🖨 QRラベル再発行
          </button>
          {error && (
            <span role="alert" className="civ-field-error">
              {error}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// 死亡個体の「誤記録を訂正 ▸」— append-only の survival_correction を追記する
// (元の death レコードは消さない・不変条項③)。生存中は非表示。
function SurvivalCorrectionLink({ profile, onChanged }: { profile: IndividualProfile; onChanged: () => void }) {
  const execute = useContext(ExecuteCtx);
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (profile.status !== "deceased") return null;

  const submit = async () => {
    if (!confirmed) return;
    setPending(true);
    setError(null);
    try {
      await execute(
        { kind: "api", method: "POST", path: `/api/v1/individuals/${profile.individual_id}/life-events` },
        { kind: "survival_correction", at: new Date().toISOString() },
      );
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="civ-disclosure" data-open={open || undefined}>
      <button
        type="button"
        className={cn("civ-interactive", "civ-button", "civ-disclosure-trigger")}
        data-variant="ghost"
        data-compact
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        誤記録を訂正 {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="civ-disclosure-body">
          <label className="civ-checkbox-row">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span className="civ-label">死亡記録は誤りで生存していることを確認しました(元の記録は消さず訂正レコードを追記します)</span>
          </label>
          <button
            type="button"
            className={cn("civ-interactive", "civ-button")}
            data-variant="secondary"
            data-compact
            disabled={!confirmed || pending}
            onClick={submit}
          >
            訂正を記録する
          </button>
          {error && (
            <span role="alert" className="civ-field-error">
              {error}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function KinshipChip({ label, muted, onClick }: { label: string; muted?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={cn("civ-interactive", "civ-card", "civ-recent-chip")}
      data-muted={muted || undefined}
      onClick={onClick}
    >
      <span className="civ-card-title">{label}</span>
    </button>
  );
}

// 変化点タイムライン: observations + life_events をマージし新しい順に描く。
// TimelineEntryはPhase 2b裁定(g85-split2a-ruling §3 #6)でcore/individual.tsへ
// 一本化済み(importは冒頭)。LIFE_ICON/LIFE_LABEL_JAはZ3専用の表示語のためここに残す。
const LIFE_ICON: Record<string, string> = {
  birth: "🐣",
  molt: "🔄",
  death: "☠",
  eclosion: "🦋",
  specimen: "🏺",
  move: "📦",
  survival_correction: "↩",
};
const LIFE_LABEL_JA: Record<string, string> = {
  birth: "誕生",
  molt: "脱皮",
  death: "死亡",
  eclosion: "羽化",
  specimen: "標本化",
  move: "移動",
  survival_correction: "生存訂正(誤記録の訂正)",
};
// prevValueFnはcore/individual.tsへ一本化済み(importは冒頭)。

// タイムライン計測行の「値を訂正 ▸」— 新しい capture を append するだけ(元の
// 記録は消さない)。POST /observation/captures は既存の単発計測エンドポイント
// (obs-register-confirm の /solid-observation/commit と同じ Truth 型)。
function CorrectionForm({
  individualId,
  item,
  unit,
  current,
  onDone,
}: {
  individualId: string;
  item: string;
  unit: string;
  current: number;
  onDone: () => void;
}) {
  const execute = useContext(ExecuteCtx);
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    setPending(true);
    setError(null);
    try {
      await execute(
        { kind: "api", method: "POST", path: "/api/v1/observation/captures" },
        {
          domain: "biology",
          subject_ref: `individual/${individualId}`,
          measurements: [{ item, kind: "number", value: n, unit, value_origin: "direct_observed" }],
        },
      );
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="civ-disclosure-body">
      <p className="civ-text" data-muted="true">
        記録値 {current}
        {unit} → 訂正後の値
      </p>
      <div className="civ-picker-row">
        <input
          className="civ-input"
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          type="button"
          className={cn("civ-interactive", "civ-button")}
          data-variant="secondary"
          data-compact
          disabled={pending || value.trim() === ""}
          onClick={submit}
        >
          訂正を記録する
        </button>
      </div>
      <p className="civ-text" data-muted="true">
        元の記録は消しません。訂正は append-only の新レコードとして追記します。
      </p>
      {error && (
        <span role="alert" className="civ-field-error">
          {error}
        </span>
      )}
    </div>
  );
}

function TimelineRow({
  entry,
  prevValueOf,
  individualId,
  onChanged,
}: {
  entry: TimelineEntry;
  prevValueOf: (captureId: string, item: string) => number | null;
  individualId: string;
  onChanged: () => void;
}) {
  const [openCorrection, setOpenCorrection] = useState(false);
  if (entry.kind === "life") {
    return (
      <li className="civ-timeline-row">
        <span aria-hidden="true">{LIFE_ICON[entry.event.kind] ?? "•"}</span>
        <span className="civ-text">
          {formatDateJa(entry.atIso)} {LIFE_LABEL_JA[entry.event.kind] ?? entry.event.kind}
        </span>
      </li>
    );
  }
  const cap = entry.capture;
  // Coerce string-valued measurements too (see measureValue() above) — a strict
  // typeof==="number" filter would silently drop template-interpolated writes
  // (obs-register-confirm.json's "{{params.weight_g}}") from the timeline row.
  const ms = (cap.measurements ?? [])
    .map((m) => ({ ...m, value: typeof m.value === "number" ? m.value : Number(m.value) }))
    .filter((m): m is ProfileMeasurement & { value: number } => Number.isFinite(m.value));
  return (
    <li className="civ-timeline-row">
      <span aria-hidden="true">📏</span>
      {cap.thumbnail_path && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="civ-timeline-thumb" src={cap.thumbnail_path} alt="" />
      )}
      <span className="civ-text">
        {formatDateJa(entry.atIso)}{" "}
        {ms.map((m, i) => {
          const prev = prevValueOf(cap.capture_id, m.item);
          const delta = prev != null ? m.value - prev : null;
          const sign = delta != null ? (delta > 0 ? "+" : delta < 0 ? "" : "±") : "";
          return (
            <span key={i}>
              {m.value}
              {m.unit ?? ""}
              {delta != null ? ` (${sign}${delta.toFixed(1)}${m.unit ?? ""})` : ""}
              {i < ms.length - 1 ? "・" : ""}
            </span>
          );
        })}
      </span>
      {ms.length > 0 && (
        <div className="civ-disclosure" data-open={openCorrection || undefined}>
          <button
            type="button"
            className={cn("civ-interactive", "civ-button", "civ-disclosure-trigger")}
            data-variant="ghost"
            data-compact
            aria-expanded={openCorrection}
            onClick={() => setOpenCorrection((o) => !o)}
          >
            値を訂正 {openCorrection ? "▾" : "▸"}
          </button>
          {openCorrection && (
            <CorrectionForm
              individualId={individualId}
              item={ms[0].item}
              unit={ms[0].unit ?? ""}
              current={ms[0].value}
              onDone={onChanged}
            />
          )}
        </div>
      )}
    </li>
  );
}

// V3-AIP-101 個体詳細スライスA 本体。ヘッダ/判断3指標/血縁レール/タイムライン
// /sticky下端バーを1画面に持つ(search-navigator/batch-summary と同じ縮退)。
function IndividualProfileNode() {
  const scope = useContext(ScopeCtx);
  const navigate = useContext(NavigateCtx);
  const execute = useContext(ExecuteCtx);
  const id = String(scope.params.id ?? "");
  const fromId = scope.params.from;
  const [profile, setProfile] = useState<IndividualProfile | null>(null);
  const [pedigree, setPedigree] = useState<PedNode | null>(null);
  // fix#1(磨き直し): placement_id→ラベル解決用(GET /placements は既存 BatchRoster
  // /search-navigator と同じ「無ければ非表示」の縮退。取れなければ [] のまま)。
  const [placements, setPlacements] = useState<PlacementRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [prof, ped, pl] = await Promise.all([
          execute({ kind: "api", method: "GET", path: `/api/v1/individuals/${id}/profile` }) as Promise<IndividualProfile>,
          execute({ kind: "api", method: "GET", path: `/api/v1/individuals/${id}/pedigree` }) as Promise<PedNode>,
          (execute({ kind: "api", method: "GET", path: "/api/v1/placements" }) as Promise<
            { placements?: PlacementRow[] } | undefined
          >).catch(() => undefined),
        ]);
        if (!alive) return;
        setProfile(prof);
        setPedigree(ped);
        setPlacements(pl?.placements ?? []);
      } catch {
        if (alive) setNotFound(true);
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const refresh = useCallback(() => navigate("individual-detail", { id }), [navigate, id]);
  const timeline = useMemo(() => (profile ? buildTimeline(profile).slice().reverse() : []), [profile]);
  const prevValueOf = useMemo(() => prevValueFn(profile?.observations ?? []), [profile]);

  if (!loaded) {
    return (
      <p className="civ-text" data-muted="true">
        読み込み中…
      </p>
    );
  }
  if (notFound || !profile) {
    return <p className="civ-empty">個体が見つかりません。</p>;
  }

  const label = profileLabel(profile);
  const stageLabel = profile.stage ? STAGE_LABELS_JA[profile.stage] ?? profile.stage : null;
  const placementLabel = placements.find((p) => p.placement_id === profile.placement_id)?.label ?? null;
  const fCoef = inbreedingCoefficient(pedigree);
  const fTone = fCoef != null ? inbreedingTone(fCoef) : null;
  const health = computeHealth(profile);
  const gotoIndividual = (targetId: string) => navigate("individual-detail", { id: targetId, from: id });
  const hasKin = !!profile.parents.sire || !!profile.parents.dam || profile.children.length > 0 || profile.siblings.length > 0;

  return (
    <div className="civ-individual-profile">
      <section className="civ-card">
        <div className="civ-card-head">
          {profile.thumbnail_path && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="civ-profile-thumb" src={profile.thumbnail_path} alt="" />
          )}
          <h2 className="civ-card-title">{label}</h2>
          <StatusMenu profile={profile} onChanged={refresh} />
        </div>
        {/* fix#1(磨き直し): obs-register-entry ヘッダと同じ言語(種/ステージ/棚を
            badge で並べる) — placement_id はラベル解決できた時だけ出す。 */}
        {(profile.species || stageLabel || placementLabel) && (
          <div className="civ-card-badges">
            {profile.species && <Badge text={profile.species} tone="neutral" />}
            {stageLabel && <Badge text={stageLabel} tone="neutral" />}
            {placementLabel && <Badge text={placementLabel} tone="neutral" />}
          </div>
        )}
        {profile.schedule && (
          <p className="civ-text" data-muted="true">
            次の目安 {formatDateJa(profile.schedule.next_observation_at)} 頃
          </p>
        )}
        <SurvivalCorrectionLink profile={profile} onChanged={refresh} />
      </section>

      <div className="civ-indicator-row">
        <section className="civ-card civ-growth-chart-card">
          <h3 className="civ-card-title">成長</h3>
          <GrowthChartView profile={profile} onLinked={refresh} />
        </section>
        <div className="civ-indicator-side">
          <section className="civ-card">
            <h3 className="civ-card-title">血統健全度</h3>
            {health ? (
              <>
                <p className="civ-text" data-muted="true">
                  同腹 {health.cohortSize}匹{health.smallSample ? "(母数小)" : ""}
                </p>
                <p className="civ-text">
                  死亡率 {health.deathPct}%{" "}
                  <span className="civ-text" data-muted="true">
                    ({health.deathCount}/{health.cohortSize})
                  </span>{" "}
                  {health.deathTone.symbol}
                  {health.deathTone.word}
                </p>
                <p className="civ-text">
                  羽化到達 {health.eclosionPct}%{" "}
                  <span className="civ-text" data-muted="true">
                    ({health.eclosionCount}/{health.cohortSize})
                  </span>
                </p>
              </>
            ) : (
              <p className="civ-text" data-muted="true">
                同腹集計なし(単体登録)
              </p>
            )}
          </section>
          <section className="civ-card">
            <h3 className="civ-card-title">近交リスク</h3>
            {fCoef != null && fTone ? (
              <p className="civ-text">
                F = {fCoef.toFixed(3)} {fTone.symbol}
                {fTone.word}
                {fCoef === 0 ? "(共通祖先なし)" : ""}
              </p>
            ) : (
              <p className="civ-text" data-muted="true">
                算定不能(血統データ無し)
              </p>
            )}
          </section>
        </div>
      </div>

      <section className="civ-card">
        <h3 className="civ-card-title">血縁</h3>
        {fromId && (
          <button
            type="button"
            className={cn("civ-interactive", "civ-button")}
            data-variant="ghost"
            data-compact
            onClick={() => navigate("individual-detail", { id: fromId })}
          >
            ← 前の個体に戻る
          </button>
        )}
        {hasKin ? (
          <div className="civ-chip-row">
            {profile.parents.sire && (
              <KinshipChip
                label={`♂ ${profile.parents.sire.label}`}
                onClick={() => gotoIndividual(profile.parents.sire!.individual_id)}
              />
            )}
            {profile.parents.dam && (
              <KinshipChip
                label={`♀ ${profile.parents.dam.label}`}
                onClick={() => gotoIndividual(profile.parents.dam!.individual_id)}
              />
            )}
            <Badge text={`${label}(この個体)`} tone="neutral" />
            {profile.children.map((c) => (
              <KinshipChip key={c.individual_id} label={c.label} onClick={() => gotoIndividual(c.individual_id)} />
            ))}
            {profile.siblings.map((s) => (
              <KinshipChip
                key={s.individual_id}
                label={s.dead ? `${s.label}(死亡)` : s.label}
                muted={s.dead}
                onClick={() => gotoIndividual(s.individual_id)}
              />
            ))}
          </div>
        ) : (
          <p className="civ-text" data-muted="true">
            血縁情報なし(単体登録)
          </p>
        )}
      </section>

      <section className="civ-card">
        <h3 className="civ-card-title">変化点タイムライン</h3>
        {timeline.length === 0 ? (
          <p className="civ-empty">記録がまだありません。</p>
        ) : (
          <ul className="civ-list civ-timeline">
            {timeline.map((entry, i) => (
              <TimelineRow key={i} entry={entry} prevValueOf={prevValueOf} individualId={id} onChanged={refresh} />
            ))}
          </ul>
        )}
      </section>

      <div className="civ-sticky-bar">
        <button
          type="button"
          className={cn("civ-interactive", "civ-button")}
          data-variant="primary"
          onClick={() => navigate("obs-register-entry", { id })}
        >
          📏 {label}に記録を追加
        </button>
        <button
          type="button"
          className={cn("civ-interactive", "civ-button")}
          data-variant="secondary"
          onClick={() => {
            savePreselect([id]);
            navigate("obs-register-batch");
          }}
        >
          まとめて記録へ
        </button>
      </div>
    </div>
  );
}

// useSourceはPhase 2b裁定(g85-split2a-ruling §3 #5)でcore/node-view.tsxへ
// 一本化済み(importは冒頭)。

registerNode("growth-chart", GrowthChartNode);
registerNode("individual-profile", IndividualProfileNode);
