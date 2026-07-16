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
