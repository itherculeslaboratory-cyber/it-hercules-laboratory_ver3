// Paper Match / Data Descriptor / Gap Analysis の純関数集約（design-k5 §2.3 / V3-PPR-01/30/06）。
// routes（paper-match-routes.ts）は薄いラッパで、判定ロジックはすべてここに閉じる。全関数は
// 決定論・常駐 DB なし・LLM 呼出なし（不変条項①・§6 人間ゲート）。近傍探索は既存の
// cosineSimilarity(@ihl/truth) を再利用（車輪の再発明をしない・CL-08 dim guard 込み）。
import { cosineSimilarity } from "@ihl/truth";
import { PAPER_SECTIONS } from "./research-constants";

// gapAnalysis の意味ギャップ近傍上位件数（散在ハードコード回避のため 1 箇所に集約）。
// ponytail: fixed top-3; 較正が要るなら research-constants.ts へ昇格が上げ道。
const NEIGHBOR_TOP_K = 3;

export interface Condition {
  min?: number;
  max?: number;
  eq?: number;
  required?: boolean;
  unit?: string;
}
export type ConditionsP = Record<string, Condition>;
export type ObservationJson = Record<string, unknown>;

export interface MatchResult {
  satisfied: string[];
  missing: string[];
  violated: string[];
  required_count: number;
  match_rate: number;
}

/**
 * matchConditions — 条件P × 観測 JSON の機械照合（PPR-01 / PPR-30 Stage1 も同一実装を再利用）。
 * 分母は required:true のキーのみ（§2.3）。required_count=0 → match_rate=1.0。
 * satisfied/missing/violated は required キーのみを対象に key 昇順で決定論列挙。
 */
export function matchConditions(conditions: ConditionsP, observation: ObservationJson): MatchResult {
  const requiredKeys = Object.keys(conditions ?? {})
    .filter((k) => conditions[k]?.required === true)
    .sort();
  const satisfied: string[] = [];
  const missing: string[] = [];
  const violated: string[] = [];
  for (const key of requiredKeys) {
    if (!(key in (observation ?? {}))) {
      missing.push(key);
      continue;
    }
    const v = Number((observation as Record<string, unknown>)[key]);
    const cond = conditions[key];
    // 非数値 or 範囲外は violated（NaN は範囲を満たせない）。
    const ok =
      Number.isFinite(v) &&
      (cond.eq === undefined || v === cond.eq) &&
      (cond.min === undefined || v >= cond.min) &&
      (cond.max === undefined || v <= cond.max);
    (ok ? satisfied : violated).push(key);
  }
  const required_count = requiredKeys.length;
  const match_rate = required_count === 0 ? 1 : satisfied.length / required_count;
  return { satisfied, missing, violated, required_count, match_rate };
}

export interface ConditionVectorEntry {
  key: string;
  value: number | null; // 観測値(観測に無い/数値化できなければ null)
  unit: string | null;
  missing: boolean; // 観測にこのキー自体が無い
}

/**
 * conditionVector — PPR-02: 条件節を「観点キー+値+単位+欠損フラグ」の観点ベクトルへ
 * 正規化する（単一正本は schemas/events/condition.schema.json）。matchConditions が
 * required キーだけの合否判定なのに対し、こちらは conditions の全キー(required/
 * optional 問わず)を key 昇順で列挙し、embedding/gap analysis(PPR-06/07)がそのまま
 * 素材にできる一様な観点ベクトルを返す(観測に無いキーは missing:true・value:null)。
 */
export function conditionVector(conditions: ConditionsP, observation: ObservationJson): ConditionVectorEntry[] {
  return Object.keys(conditions ?? {})
    .sort()
    .map((key) => {
      const cond = conditions[key];
      const has = key in (observation ?? {});
      const raw = has ? Number((observation as Record<string, unknown>)[key]) : NaN;
      return {
        key,
        value: has && Number.isFinite(raw) ? raw : null,
        unit: cond?.unit ?? null,
        missing: !has,
      };
    });
}

export interface MissingKeyHint {
  key: string;
  // 推奨レンジ(min/max/eq/unit から機械合成)。条件が数値レンジを持たない場合は省略。
  range?: string;
}

/**
 * hintsForMissing — 不足キーへのサーバ側ヒント(V3-PPR-01)。LLM を使わず conditions の
 * min/max/eq/unit から決定論的に「推奨レンジ」を合成する(RAG参照の最小実装＝静的辞書
 * 引き、センサー設置法/類似観測本文の生成はしない・§6 人間ゲート)。missing の順序を保つ。
 */
export function hintsForMissing(conditions: ConditionsP, missing: string[]): MissingKeyHint[] {
  return missing.map((key) => {
    const cond = conditions[key];
    const parts: string[] = [];
    if (cond?.eq !== undefined) parts.push(`${cond.eq}`);
    if (cond?.min !== undefined) parts.push(`${cond.min}以上`);
    if (cond?.max !== undefined) parts.push(`${cond.max}以下`);
    if (!parts.length) return { key };
    const unit = cond?.unit ? `${cond.unit}` : "";
    return { key, range: `${parts.join("・")}${unit}` };
  });
}

export interface SectionState {
  filled: boolean;
  text: string;
}
export interface TemplateClaim {
  claim_id: string;
  statement: string;
  // 依存する条件キー（充足で evidenced 化）。未指定＝未検証固定（hypothesis）。
  evidence_keys?: string[];
}
export interface FilledClaim {
  claim_id: string;
  statement: string;
  status: "hypothesis" | "evidenced";
  evidence_refs: string[];
}
export interface DescriptorTemplate {
  sections?: Record<string, SectionState>;
  conditions?: ConditionsP;
  claims?: TemplateClaim[];
}
export interface DescriptorResult {
  sections: Record<string, SectionState>;
  claims: FilledClaim[];
  match: MatchResult;
}

/**
 * computeSectionsCompleteness — PaperSectionsV1 6 節（V3-PPR-03 design_only の投影骨格）。
 * PAPER_SECTIONS（research-constants.ts・単一正本）の filled 件数から 0–100 の完了率を
 * 決定論算出する。content.schema.json の completeness_pct はクライアント入力値のままだが、
 * ここでは書込に依存しないサーバ側の再計算版を提供し、GET 投影で並記できるようにする
 * （PPR-03「各節に filled フラグと completeness_pct を持たせる」の投影側担保）。
 */
export function computeSectionsCompleteness(sections: Record<string, SectionState> | undefined): number {
  if (!sections) return 0;
  const filledCount = PAPER_SECTIONS.filter((k) => sections[k]?.filled === true).length;
  return Math.round((filledCount / PAPER_SECTIONS.length) * 100);
}

// ── autoGeneratePaperDraft(PPR-20)───────────────────────────────────────────
// PaperSectionsV1(PPR-03 実装済み)の拡張として、統一フォーマットの観測データ
// (measurements[] = item/value/unit・obs-capture.schema.json と同一形状)のみから
// 論文の conditions 節を機械生成する。別データフォーマットは新設しない(既存の
// measurement 形状を再利用・ponytail: rung2)。
export interface UnifiedMeasurement {
  item: string;
  value: number;
  unit?: string;
}
export interface UnifiedMeasurementSummary {
  unit?: string;
  min: number;
  max: number;
  mean: number;
  n: number;
}

/** summarizeUnifiedMeasurements — item ごとの min/max/mean/n を決定論集計(PPR-20)。 */
export function summarizeUnifiedMeasurements(
  observations: { measurements?: UnifiedMeasurement[] }[],
): Record<string, UnifiedMeasurementSummary> {
  const byItem = new Map<string, UnifiedMeasurement[]>();
  for (const obs of observations) {
    for (const m of obs.measurements ?? []) {
      if (typeof m.item !== "string" || typeof m.value !== "number") continue;
      (byItem.get(m.item) ?? byItem.set(m.item, []).get(m.item)!).push(m);
    }
  }
  const out: Record<string, UnifiedMeasurementSummary> = {};
  for (const [item, rows] of byItem) {
    const values = rows.map((r) => r.value);
    out[item] = {
      unit: rows.find((r) => r.unit)?.unit,
      min: Math.min(...values),
      max: Math.max(...values),
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      n: values.length,
    };
  }
  return out;
}

export interface PaperDraft {
  title: string;
  sections: Record<string, SectionState>;
  conditions: ConditionsP;
  completeness_pct: number;
}

/**
 * autoGeneratePaperDraft — 統一フォーマットの観測データのみから論文下書きを自動生成する
 * (PPR-20「データのみから論文を自動生成できる仕組み」)。conditions 節は観測 min/max から
 * required:true の観測レンジとして機械合成し、conditions 節本文(text)に集計表を並べる。
 * purpose/hypothesis/phase/gap は人間の記述が要るため filled:false のまま(機械が勝手に
 * 主張を作らない=不変条項⑤の精神)。verification は充足有無を機械算出(空観測=false)。
 */
export function autoGeneratePaperDraft(
  observations: { measurements?: UnifiedMeasurement[] }[],
  meta: { title: string },
): PaperDraft {
  const summary = summarizeUnifiedMeasurements(observations);
  const items = Object.keys(summary).sort();
  const conditions: ConditionsP = {};
  for (const item of items) {
    const s = summary[item];
    conditions[item] = { min: s.min, max: s.max, required: true, ...(s.unit ? { unit: s.unit } : {}) };
  }
  const conditionsText = items
    .map((item) => {
      const s = summary[item];
      return `${item}: ${s.min}〜${s.max}(平均${s.mean.toFixed(2)}${s.unit ?? ""}・n=${s.n})`;
    })
    .join("; ");
  const sections: Record<string, SectionState> = {
    purpose: { filled: false, text: "" },
    hypothesis: { filled: false, text: "" },
    conditions: { filled: items.length > 0, text: conditionsText },
    verification: { filled: false, text: "" },
    phase: { filled: false, text: "" },
    gap: { filled: false, text: "" },
  };
  return { title: meta.title, sections, conditions, completeness_pct: computeSectionsCompleteness(sections) };
}

/**
 * autoFillDescriptor — 観測を Data Descriptor に投影して穴埋め（PPR-30）。
 * Stage1 機械検査は matchConditions を再利用（同一実装）。充足キー → 対応 claim の
 * evidence_refs に自動リンク・status=evidenced。未検証 claim（evidence_keys 未充足/未指定）は
 * status=hypothesis 固定 ＝ AI/機械が勝手に証拠化しない。verification 節は充足キーで自動充填。
 */
export function autoFillDescriptor(template: DescriptorTemplate, observation: ObservationJson): DescriptorResult {
  const match = matchConditions(template.conditions ?? {}, observation ?? {});
  const satisfiedSet = new Set(match.satisfied);

  const sections: Record<string, SectionState> = { ...(template.sections ?? {}) };
  // 観測から機械的に検証節を穴埋め（決定論の 1 行サマリ・LaTeX 記号を持たない）。
  const allRequiredMet = match.required_count > 0 && match.satisfied.length === match.required_count;
  sections.verification = {
    filled: allRequiredMet,
    text: match.satisfied.length ? `verified: ${match.satisfied.join(", ")}` : "",
  };

  const claims: FilledClaim[] = (template.claims ?? []).map((cl) => {
    const keys = (cl.evidence_keys ?? []).slice().sort();
    const evidenced = keys.length > 0 && keys.every((k) => satisfiedSet.has(k));
    return {
      claim_id: cl.claim_id,
      statement: cl.statement,
      status: evidenced ? "evidenced" : "hypothesis",
      evidence_refs: evidenced ? keys : [],
    };
  });

  return { sections, claims, match };
}

// ── quadrantAnalysis(PPR-07)─────────────────────────────────────────────────
// QUADRANT_GAP_DENSITY_THRESHOLD — 象限密度がこの値未満(既定 5%)かつ未論文化なら
// 「研究の空白領域」として検出する(要件例示値をそのまま採用)。
// ponytail: 較正 knob。運用実測で調整(GUI 後波・V3-GOV-17)。
export const QUADRANT_GAP_DENSITY_THRESHOLD = 0.05;

export type Quadrant = "n11" | "n10" | "n01" | "n00";
export const QUADRANTS: readonly Quadrant[] = ["n11", "n10", "n01", "n00"];

export interface QuadrantCounts {
  n11: number; // P∧Q
  n10: number; // P∧¬Q
  n01: number; // ¬P∧Q
  n00: number; // ¬P∧¬Q
  total: number;
}
export interface QuadrantDensity extends QuadrantCounts {
  density: Record<Quadrant, number>;
  gaps: Quadrant[]; // 密度が閾値未満(=薄い象限=研究の空白領域)
}

/**
 * quadrantAnalysis — 観測データの4象限モデル(PPR-07)。conditions の required キーを
 * 2 グループに分ける: claim.evidence_keys に載るキー=Q(主張の証拠条件)、それ以外の
 * required キー=P(前提条件)。各キーの充足判定は matchConditions を 1 回呼んで再利用
 * (同一実装・車輪の再発明をしない=autoFillDescriptor の evidenced 判定と同じ式)。
 * observation 1 件ごとに P/Q を機械判定して4象限へ分類し、密度(件数/総数)が閾値未満の
 * 象限を「薄い象限=未論文化の研究空白」として gaps に列挙する(決定論・都度再計算)。
 * P 定義キーが無ければ「P は常に真」(matchConditions の required_count=0 既定と同じ)。
 */
export function quadrantAnalysis(
  conditions: ConditionsP,
  claim: TemplateClaim,
  observations: ObservationJson[],
  threshold: number = QUADRANT_GAP_DENSITY_THRESHOLD,
): QuadrantDensity {
  const evidenceKeys = new Set((claim.evidence_keys ?? []).slice().sort());
  const pKeys = Object.keys(conditions ?? {}).filter((k) => conditions[k]?.required === true && !evidenceKeys.has(k));
  let n11 = 0, n10 = 0, n01 = 0, n00 = 0;
  for (const obs of observations) {
    const satisfiedSet = new Set(matchConditions(conditions, obs).satisfied);
    const p = pKeys.length === 0 || pKeys.every((k) => satisfiedSet.has(k));
    const q = evidenceKeys.size > 0 && [...evidenceKeys].every((k) => satisfiedSet.has(k));
    if (p && q) n11++;
    else if (p && !q) n10++;
    else if (!p && q) n01++;
    else n00++;
  }
  const total = observations.length;
  const density: Record<Quadrant, number> = total
    ? { n11: n11 / total, n10: n10 / total, n01: n01 / total, n00: n00 / total }
    : { n11: 0, n10: 0, n01: 0, n00: 0 };
  const gaps = QUADRANTS.filter((k) => density[k] < threshold);
  return { n11, n10, n01, n00, total, density, gaps };
}

export interface DerivedPropositions {
  converse: string; // 逆(Q⇒P)
  inverse: string; // 裏(¬P⇒¬Q)
  contrapositive: string; // 対偶(¬Q⇒¬P)
}

/**
 * derivePropositions — 確定命題(P⇒Q)から逆・裏・対偶を機械的に生成する(PPR-07)。
 * 命題論理の恒等変形のみ(LLM 不使用・決定論・pLabel/qLabel の文字列合成)。
 */
export function derivePropositions(pLabel: string, qLabel: string): DerivedPropositions {
  return {
    converse: `${qLabel} ⇒ ${pLabel}`,
    inverse: `¬(${pLabel}) ⇒ ¬(${qLabel})`,
    contrapositive: `¬(${qLabel}) ⇒ ¬(${pLabel})`,
  };
}

export interface HypothesisDraft {
  quadrant: Quadrant;
  title: string;
  abstract: string;
}

// 象限ごとの仮説論文タイトル/要旨テンプレ(決定論テンプレ文合成・LLM 不使用・PPR-07)。
const QUADRANT_HYPOTHESIS_TEMPLATE: Record<Quadrant, (p: string, q: string) => HypothesisDraft> = {
  n11: (p, q) => ({
    quadrant: "n11",
    title: `${p}かつ${q}の再現性検証`,
    abstract: `${p}と${q}が同時に観測された事例は少ない。追加観測でこの組合せの再現性を検証する。`,
  }),
  n10: (p, q) => ({
    quadrant: "n10",
    title: `${p}にもかかわらず${q}が成立しない条件の探索`,
    abstract: `${p}を満たしながら${q}に至らない事例(逆の反証候補)が薄い。境界条件を仮説論文として提起する。`,
  }),
  n01: (p, q) => ({
    quadrant: "n01",
    title: `${p}なしで${q}が成立する経路の探索`,
    abstract: `${p}を満たさずに${q}が観測される事例(裏の反証候補)が薄い。別要因の関与を仮説論文として提起する。`,
  }),
  n00: (p, q) => ({
    quadrant: "n00",
    title: `${p}と${q}がともに不成立な事例の対偶検証`,
    abstract: `${p}も${q}も不成立な事例(対偶の裏付け候補)が薄い。対偶(¬${q}⇒¬${p})の追試が必要。`,
  }),
};

/** hypothesisDraftsForGaps — gaps の各象限に対応する仮説論文タイトル・要旨を生成(PPR-07)。 */
export function hypothesisDraftsForGaps(gaps: Quadrant[], pLabel: string, qLabel: string): HypothesisDraft[] {
  return gaps.map((g) => QUADRANT_HYPOTHESIS_TEMPLATE[g](pLabel, qLabel));
}

export interface NeighborPaper {
  content_id?: string;
  conditions?: ConditionsP;
  vector?: number[];
}
export interface GapPaper {
  conditions?: ConditionsP;
  vector?: number[];
}
export interface GapResult {
  data_gap: string[];
  semantic_gap: string[];
  missing_perspectives: string[];
}

/**
 * gapAnalysis — 全種族横断のギャップ抽出（PPR-06）。
 * data_gap = required 条件キー − 観測キー（観測なしなら required 全キー）。
 * semantic_gap = 近傍論文（cosineSimilarity 上位 NEIGHBOR_TOP_K）の条件キー ∪ − 当該 paper キー。
 * missing_perspectives = data_gap ∪ semantic_gap を key 名昇順で安定列挙（決定論）。
 * ベクトルが無ければ semantic_gap=[] で data_gap のみ返す（embedding 既定 OFF でも動く・不変条項①）。
 * ponytail: neighbors は species 非フィルタ（全種族横断）。呼び手が候補集合を渡す。
 */
export function gapAnalysis(paper: GapPaper, neighbors: NeighborPaper[], observation?: ObservationJson): GapResult {
  const conditions = paper.conditions ?? {};
  const requiredKeys = Object.keys(conditions).filter((k) => conditions[k]?.required === true);
  const observedKeys = observation ? Object.keys(observation) : [];
  const data_gap = requiredKeys.filter((k) => !observedKeys.includes(k)).sort();

  let semantic_gap: string[] = [];
  const pv = paper.vector;
  if (Array.isArray(pv) && pv.length > 0) {
    const paperKeys = new Set(Object.keys(conditions));
    const ranked = (neighbors ?? [])
      .filter((n) => Array.isArray(n.vector) && n.vector.length === pv.length)
      .map((n) => ({ n, sim: cosineSimilarity(pv, n.vector as number[]) }))
      .sort((a, b) => b.sim - a.sim || String(a.n.content_id ?? "").localeCompare(String(b.n.content_id ?? "")))
      .slice(0, NEIGHBOR_TOP_K);
    const union = new Set<string>();
    for (const { n } of ranked) for (const k of Object.keys(n.conditions ?? {})) union.add(k);
    semantic_gap = [...union].filter((k) => !paperKeys.has(k)).sort();
  }

  const missing_perspectives = [...new Set([...data_gap, ...semantic_gap])].sort();
  return { data_gap, semantic_gap, missing_perspectives };
}
