// KRM-10/11/12 3 軸貢献度エンジン + PT 影響力投影 + 免罪符ステージ（非 cron 部分）。
// 全て純関数 or prefix-scan+reduce の projectLedger 型・都度再計算（常駐 DB 禁止・
// 不変条項①）。月次還元（KRM-11 rebate）/ 月次 Fib 降下（KRM-12）は cron=P6 に分離。
import { TruthStore, ulid, type PutEventResult } from "@ihl/truth";
import { fib } from "./ledger-routes";
import {
  CONTRIBUTION_PER_PLATINUM,
  CONTRIBUTION_TITLE_THRESHOLD,
  UPSTREAM_PERCENT,
  KRM29_PRO_RESEARCHER_THRESHOLD,
  KRM29_CITIZEN_SCIENTIST_THRESHOLD,
  CONTRIB_INDIVIDUAL_CREATED,
} from "./economy-constants";
import { projectCohortCompleteness } from "./cohort-completeness";

export const PT_TYPE = "ihl.economy.pt_event.v1";
export const CONTRIBUTION_TYPE = "ihl.economy.contribution_event.v1";
const CONTRIBUTION_SCHEMA = "schemas/events/economy-contribution-event.schema.json";
const SCHEMA_VERSION = "1";

export type Axis = "research" | "capital" | "development";
export const AXES: readonly Axis[] = ["research", "capital", "development"];

function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

// ── 鋳造導出（KRM-12）───────────────────────────────────────────────────
// 軸スコアから鋳造枚数・次閾値・端数繰越を導出。閾値は増分 Fibonacci 列
// PER_PLATINUM*fib(n)=100,100,200,300,500…。minted 枚ごとに step を累積消費し、
// 端数（carry = score - 消費累計）は非減衰で次の鋳造へ繰り越す（累計残高非減衰）。
export function mintFromScore(score: number): {
  minted: number;
  next_threshold: number;
  carry: number;
} {
  let minted = 0;
  let consumed = 0;
  while (score >= consumed + CONTRIBUTION_PER_PLATINUM * fib(minted + 1)) {
    consumed += CONTRIBUTION_PER_PLATINUM * fib(minted + 1);
    minted += 1;
  }
  return {
    minted,
    next_threshold: CONTRIBUTION_PER_PLATINUM * fib(minted + 1),
    carry: score - consumed,
  };
}

// ── 3 軸貢献度投影（KRM-10/11/12）──────────────────────────────────────
export interface AxisState {
  score: number;
  minted: number;
  next_threshold: number;
  carry: number;
  title: boolean; // score ≥ 閾値で称号（KRM-11・イベント不要＝投影導出）
}
export interface ContributionProjection {
  actor_id: string;
  axes: Record<Axis, AxisState>;
  // axes を配列でも公開（ScreenDef の list bind_items 用・object は key 参照用に維持）。
  axis_list: Array<{ axis: Axis } & AxisState>;
}

// ponytail: contribution_event 全型を prefix scan + actor フィルタ = O(n)。MVP 量で十分。
export async function projectContribution(
  s: TruthStore,
  actorId: string,
): Promise<ContributionProjection> {
  const events = (await s.listEvents(`truth/${CONTRIBUTION_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.actor_id === actorId); // 本人スコープ（V3-AUT-17）
  const scores: Record<Axis, number> = { research: 0, capital: 0, development: 0 };
  for (const d of events) {
    const axis = d.axis as Axis;
    const delta = typeof d.delta === "number" ? d.delta : 0;
    // 非負累積 invariant: 減算は append 側 guard で拒否済だが投影でも防御的に無視。
    if ((AXES as readonly string[]).includes(axis) && delta > 0) scores[axis] += delta;
  }
  const axes = {} as Record<Axis, AxisState>;
  for (const axis of AXES) {
    axes[axis] = {
      score: scores[axis],
      ...mintFromScore(scores[axis]),
      title: scores[axis] >= CONTRIBUTION_TITLE_THRESHOLD,
    };
  }
  const axis_list = AXES.map((axis) => ({ axis, ...axes[axis] }));
  return { actor_id: actorId, axes, axis_list };
}

// ── 3階層(V3-KRM-29・design19 §T1-6 案A)────────────────────────────────
// 役職(role文字列)を新規発行しない。既存3軸貢献度スコアの閾値から導出する純関数のみ。
// 表示バッジは KRM-17 の称号をそのまま使う(このファイルは判定のみ・二重に作らない)。
// 閾値は economy-constants.ts の暫定既定(KRM29_PRO_RESEARCHER_THRESHOLD=1000・
// KRM29_CITIZEN_SCIENTIST_THRESHOLD=100・同ファイルコメント参照=要件本文未確定のため
// CONTRIBUTION_TITLE_THRESHOLD より1桁小さい値を暫定既定とした)。
export type ContributorTier = "pro_researcher" | "citizen_scientist" | "enjoy";

/**
 * scores(3軸の生スコア。projectContribution(...).axes から呼び出し側が抽出する)から
 * 階層を導出する純関数。プロ研究者=research軸がKRM29_PRO_RESEARCHER_THRESHOLD以上。
 * 市民科学者/ブリーダー=いずれかの軸がKRM29_CITIZEN_SCIENTIST_THRESHOLD以上。それ以外=
 * エンジョイ勢(既定)。「プロ研究者」資格審査の要否はHQ裁定事項のため、本関数は閾値のみで
 * 判定する(審査機構は作らない)。
 */
export function tier(scores: Record<Axis, number>): ContributorTier {
  if (scores.research >= KRM29_PRO_RESEARCHER_THRESHOLD) return "pro_researcher";
  if (AXES.some((axis) => scores[axis] >= KRM29_CITIZEN_SCIENTIST_THRESHOLD)) return "citizen_scientist";
  return "enjoy";
}

/** actor_id から直接階層を求める便宜関数(projectContribution を1回呼ぶだけ・二重投影なし)。 */
export async function tierOf(s: TruthStore, actorId: string): Promise<ContributorTier> {
  const { axes } = await projectContribution(s, actorId);
  const scores = { research: axes.research.score, capital: axes.capital.score, development: axes.development.score } as Record<Axis, number>;
  return tier(scores);
}

// 貢献イベントを append する共有ヘルパ(github-webhook-routes.ts はそれ以前から独自に
// envelope を組んでいるため据置・新規呼び出し元=V3-KRM-28 観測commit/個体作成フックは
// これを再利用しコピペ二重化しない)。delta<=0 は何もしない(schema minimum:0 と
// 同じ non-negative invariant をルート側で守るための早期 no-op)。
export async function appendContribution(
  s: TruthStore,
  actorId: string,
  nodeId: string,
  axis: Axis,
  delta: number,
  source: string,
  sourceRef?: string,
): Promise<PutEventResult | null> {
  if (!(delta > 0)) return null;
  const id = ulid();
  const data: Record<string, unknown> = {
    contribution_event_id: id,
    node_id: nodeId,
    actor_id: actorId,
    axis,
    delta,
    source,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (sourceRef) data.source_ref = sourceRef;
  return s.putEvent({
    specversion: "1.0",
    id,
    source: "apps/api",
    type: CONTRIBUTION_TYPE,
    time: new Date().toISOString(),
    dataschema: CONTRIBUTION_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  });
}

// ── S8 コホート完結性への接続（V3-KRM-35・design R0801-f383db §4.5・
// RULING-2026-08-01-gen75-hqrulings.md R75-1/R75-2/R75-3）─────────────────
// 新機構は作らない: 加算口は appendContribution(F23)をそのまま再利用し、
// completeness_ratio は S7 projectCohortCompleteness を関数として再利用する
// (HTTPを内部で叩かない・cohort-completeness.ts のロジックは変更しない)。
// ★判断(報告書に記載): economy-contribution-event.schema.json の source は
// enum固定("github"/"board"/"fork"/"vote"/"tax"/"manual"/"observation")で、
// このスキーマファイルは発注書の「触ってよいファイル」に含まれない(スキーマ変更禁止)。
// 新しい列挙値を足す代わりに既存の "observation" を再利用する(F24の個体作成/観測フックと
// 同じ出所区分。「終端life-eventの記録」も観測行為の一種であり意味的に矛盾しない)。
// 条件群の一意性は source_ref(= groupKey = clutchId:kind:atStage)側で確保する。
const COHORT_TERMINAL_SOURCE = "observation";
const CLUTCH_TYPE_FOR_PAYOUT = "ihl.ind.clutch.v1";
const CLUTCH_EVENT_TYPE_FOR_PAYOUT = "ihl.ind.clutch_event.v1";
// R75-3: 初齢除外の実装は at_stage による判定。death.detail.at_stage は
// スキーマ上 additionalProperties:true の自由記述だが、このコードベースで
// 齢を表す唯一の実在語彙は observation-constants.ts STAGE_TO_NEXT_TRANSITION
// の to_stage 語彙("first"/"second"/"third_early"/"third_late")なので、
// death.detail.at_stage が "first" と等しい場合を初齢(first_instar相当)として
// 除外する(★判断: 報告書に記載)。
const FIRST_INSTAR_STAGE = "first";
// R75-1: A=1.0/B=0.5/C=0.1。
const GRADE_COEF: Record<"A" | "B" | "C", number> = { A: 1.0, B: 0.5, C: 0.1 };

/**
 * evidence_grade 判定(design §4.3・R75-1)。環境系列の有無判定(A)は実装上
 * 保守的に見送る(R75-1が明示的に許可)。
 * ★判断(報告書に記載): design §4.3 の A/B/C 三値は死亡記録を念頭に定義されて
 * いるが、design §4.2 の終端3値(成体観測済み/N令死亡/追跡不能)全体に payout を
 * 接続する必要がある(T1)ため、death 以外にも一意に判定を広げた:
 * - eclosion(成体観測済み): 直接観測そのものが終端証拠であり環境系列相当の
 *   曖昧さが無い最強のケースとして A 固定。
 * - lost(追跡不能): スキーマ上 detail 自体が任意で終端観測の要求が無く、
 *   「申告のみ」の定義(R75-1)にそのまま一致するため C 固定。
 * - death: スキーマ(S6 if/then)が terminal_observation を必須化しているため
 *   新規書き込みは常に B。terminal_observation が欠落したデータ(スキーマ導入
 *   前の旧データ等・本関数はそれも防御的に判定する)は C。
 */
export function evidenceGrade(kind: string, detail: Record<string, unknown> | undefined): "A" | "B" | "C" {
  if (kind === "lost") return "C";
  if (kind === "eclosion") return "A";
  const hasTerminalObservation =
    !!detail && typeof detail.terminal_observation === "object" && detail.terminal_observation !== null;
  return hasTerminalObservation ? "B" : "C";
}

/**
 * individual_id が属する clutch_id を promote イベント(promoted_individual_ids)
 * から逆引きする(個体マスタ自体は clutch_id を持たないため・F19)。
 * promote 経由で生まれていない個体(クラッチ機構の外)は null。
 */
async function findClutchIdForIndividual(s: TruthStore, individualId: string): Promise<string | null> {
  const events = (await s.listEvents(`truth/${CLUTCH_EVENT_TYPE_FOR_PAYOUT}/`)).map(dataOf);
  for (const e of events) {
    if (e.kind === "promote" && Array.isArray(e.promoted_individual_ids) && e.promoted_individual_ids.includes(individualId)) {
      return typeof e.clutch_id === "string" ? e.clutch_id : null;
    }
  }
  return null;
}

/**
 * 条件群(clutch_id, kind, at_stage)内での既払い件数(R75-2)。同じ groupKey を
 * source_ref に積んだ既存 contribution_event を数えるだけ(常駐カウンタ無し・
 * 都度再計算・不変条項①)。
 */
async function countPriorPayoutsInGroup(s: TruthStore, groupKey: string): Promise<number> {
  const events = (await s.listEvents(`truth/${CONTRIBUTION_TYPE}/`)).map(dataOf);
  return events.filter((d) => d.source === COHORT_TERMINAL_SOURCE && d.source_ref === groupKey).length;
}

/**
 * S8 本体: コホートの終端記録(death/eclosion/lost)に対する貢献度加算
 * (design §4.5・R75-1/R75-2/R75-3)。
 * 式(条件群の累積) f(n) = v_base × (1 + log2 n)。この個体が条件群の n 番目なら
 * 加算するのは f(n) − f(n−1) という増分だけ(append-only なので過去分は書き直せない
 * ため、逓減を「増分の縮小」として実現する。f(0)=0 と定義)。
 * v_base = CONTRIB_INDIVIDUAL_CREATED(=10・既存の1匹あたり加点相場。ユーザー例示
 * 「一匹につき10貢献度」と一致するためこの値を再利用し新定数を作らない)。
 * grade_coef と completeness_ratio はこの個体の増分にそのまま乗算する
 * (★判断: 条件群全体を1回で払う設計ではなく個体ごとの終端イベントで払う都度払いの
 * ため、conditions群内で等級が混在する場合も個体ごとの等級が正しく反映される)。
 * 初齢(R75-3)は加算そのものをスキップする(null を返す=イベント無し)。
 * クラッチ外(promote されていない個体)や存在しないクラッチも同様にスキップする
 * (対象外・報告書に判断理由を記載)。
 */
export async function appendCohortTerminalContribution(
  s: TruthStore,
  individualId: string,
  kind: string,
  detail: Record<string, unknown> | undefined,
): Promise<PutEventResult | null> {
  if (kind !== "death" && kind !== "eclosion" && kind !== "lost") return null;
  const atStage = kind === "death" && typeof detail?.at_stage === "string" ? detail.at_stage : null;
  if (kind === "death" && atStage === FIRST_INSTAR_STAGE) return null; // R75-3

  const clutchId = await findClutchIdForIndividual(s, individualId);
  if (!clutchId) return null;
  const clutch = await s.readEvent(`truth/${CLUTCH_TYPE_FOR_PAYOUT}/${clutchId}.json`);
  if (!clutch) return null;
  const clutchActorId = dataOf(clutch).actor_id;
  if (typeof clutchActorId !== "string" || !clutchActorId) return null;

  const completeness = await projectCohortCompleteness(s, clutchId);
  const ratio = completeness ? Number(completeness.completeness_ratio ?? 0) : 0;
  const gradeCoef = GRADE_COEF[evidenceGrade(kind, detail)];

  const groupKey = `${clutchId}:${kind}:${atStage ?? "none"}`;
  const priorCount = await countPriorPayoutsInGroup(s, groupKey);
  const n = priorCount + 1;
  const fPrev = n > 1 ? 1 + Math.log2(n - 1) : 0;
  const fCur = 1 + Math.log2(n);
  const delta = CONTRIB_INDIVIDUAL_CREATED * (fCur - fPrev) * gradeCoef * ratio;

  return appendContribution(s, clutchActorId, individualId, "research", delta, COHORT_TERMINAL_SOURCE, groupKey);
}

// ── 依存グラフ配分（KRM-11・純関数 reducer）─────────────────────────────
// 子ノードへ delta を加算。祖先があれば UPSTREAM_PERCENT を祖先へ均等配分し、子は
// その分を減額（保存＝総和は delta のまま）。祖先無しは配分せず子に全額残す。
// 減算（delta<0）は非負累積 invariant 違反で throw（KRM-10）。scores を破壊的更新し返す。
export type ContribScores = Record<string, Record<Axis, number>>;

export function applyContributionDelta(
  scores: ContribScores,
  nodeId: string,
  axis: Axis,
  delta: number,
  ancestors: string[] = [],
): ContribScores {
  if (!(delta >= 0)) {
    throw new Error("contribution delta must be >= 0 (non-negative accumulation invariant)");
  }
  const bump = (id: string, amt: number) => {
    const row = scores[id] ?? (scores[id] = { research: 0, capital: 0, development: 0 });
    row[axis] += amt;
  };
  const upstream = ancestors.length > 0 ? delta * UPSTREAM_PERCENT : 0;
  bump(nodeId, delta - upstream);
  if (ancestors.length > 0) {
    const per = upstream / ancestors.length;
    for (const a of ancestors) bump(a, per);
  }
  return scores;
}

// ── フォーク系譜解決（KRM-12・round-16裁定「フォーク10%=金銭でなく貢献度の分配」）──
// フォークされたテンプレ/部品が使われた時、使用者に付与される貢献度の10%を
// 「上流(部品/コンポーネント作者・処理/技術開発者・元テンプレ作者)へlineageに
// 沿って」分配する — 単純に親1件だけでなく forked_from を辿れるだけ辿った
// 全上流（祖父母世代以前も含む）を ancestors として集める。applyContributionDelta
// は既に ancestors 配列全体へ 10% を均等配分する汎用実装（KRM-11 と共有）なので、
// 本関数はその配列を「lineage 全体」から機械的に作るだけの純関数(ドメイン非依存:
// market テンプレート/proposal フォーク等、forked_from を持つ任意のノード列を渡せる
// — market-*routes 自体はこのレーンの担当外のため配線しない。呼び出し側で
// この関数の戻り値を applyContributionDelta(..., ancestors) に渡すだけでよい)。
// 循環参照は visited セットで防御（壊れた/自己参照データでも無限ループしない）。
export function resolveLineage(
  nodes: { node_id: string; forked_from?: string }[],
  nodeId: string,
): string[] {
  const byId = new Map(nodes.map((n) => [n.node_id, n]));
  const lineage: string[] = [];
  const visited = new Set<string>([nodeId]);
  let cur = byId.get(nodeId)?.forked_from;
  while (cur && !visited.has(cur)) {
    lineage.push(cur);
    visited.add(cur);
    cur = byId.get(cur)?.forked_from;
  }
  return lineage;
}

// appendForkContribution — フォーク系譜への貢献度10%分配(V3-MKT-36層3・round-16裁定
// 「フォーク10%=金銭でなく貢献度の分配」)を1呼び出しで完結させるフック関数。resolveLineage()
// で forked_from を辿った上流ノード列を求め、UPSTREAM_PERCENT(10%)を均等配分してから
// appendContribution() を各ノードへ発行する(split計算はapplyContributionDeltaと同じ配分式を
// 踏襲・コピペ二重化しない)。呼び出し側(market/plaza等のフォークroute・本レーンglob外)は
// nodes配列(node_id/forked_from)を渡すだけでよい。ancestors 0件時は上流分配なし=nodeIdへ全額。
export async function appendForkContribution(
  s: TruthStore,
  actorId: string,
  nodes: { node_id: string; forked_from?: string }[],
  nodeId: string,
  axis: Axis,
  delta: number,
  source: string,
  sourceRef?: string,
): Promise<PutEventResult[]> {
  if (!(delta > 0)) return [];
  const ancestors = resolveLineage(nodes, nodeId);
  const upstream = ancestors.length > 0 ? delta * UPSTREAM_PERCENT : 0;
  const results: PutEventResult[] = [];
  const own = await appendContribution(s, actorId, nodeId, axis, delta - upstream, source, sourceRef);
  if (own) results.push(own);
  if (ancestors.length > 0) {
    const per = upstream / ancestors.length;
    for (const ancestorId of ancestors) {
      const r = await appendContribution(s, actorId, ancestorId, axis, per, source, sourceRef);
      if (r) results.push(r);
    }
  }
  return results;
}

// ── PT 影響力投影（KRM-10・非公開＝本人のみ）─────────────────────────────
export async function listPtEvents(
  s: TruthStore,
  actorId: string,
): Promise<Record<string, unknown>[]> {
  return (await s.listEvents(`truth/${PT_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.actor_id === actorId);
}

export async function projectPt(
  s: TruthStore,
  actorId: string,
): Promise<{ actor_id: string; balance: number }> {
  const events = await listPtEvents(s, actorId);
  const balance = events.reduce(
    (a, d) => a + (typeof d.delta === "number" ? d.delta : 0),
    0,
  );
  return { actor_id: actorId, balance };
}

// ── 免罪符ステージ（KRM-05・純関数）─────────────────────────────────────
// 初期 1、indulgence_spend 購入ごと +1、UTC 暦月境界を跨ぐごと -1、下限 1。
// events は本人の pt_event data 配列。now 時点のステージを時系列畳み込みで求める。
// 価格 PT = fib(stage)（初回 fib(1)=1PT）。
function utcMonths(a: Date, b: Date): number {
  return (
    (b.getUTCFullYear() * 12 + b.getUTCMonth()) -
    (a.getUTCFullYear() * 12 + a.getUTCMonth())
  );
}

export function indulgenceStage(
  events: Record<string, unknown>[],
  actorId: string,
  now: Date,
): number {
  const buys = events
    .filter(
      (d) =>
        d.actor_id === actorId &&
        d.reason_code === "indulgence_spend" &&
        typeof d.created_at === "string",
    )
    .map((d) => new Date(d.created_at as string))
    .sort((a, b) => a.getTime() - b.getTime());
  let stage = 1;
  let last: Date | null = null;
  for (const t of buys) {
    if (last) stage = Math.max(1, stage - utcMonths(last, t)); // 経過月ぶん降下
    stage += 1; // 購入で上昇
    last = t;
  }
  if (last) stage = Math.max(1, stage - utcMonths(last, now)); // 最終購入→現在の降下
  return stage;
}
