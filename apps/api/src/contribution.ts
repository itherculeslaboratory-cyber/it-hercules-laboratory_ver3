// KRM-10/11/12 3 軸貢献度エンジン + PT 影響力投影 + 免罪符ステージ（非 cron 部分）。
// 全て純関数 or prefix-scan+reduce の projectLedger 型・都度再計算（常駐 DB 禁止・
// 不変条項①）。月次還元（KRM-11 rebate）/ 月次 Fib 降下（KRM-12）は cron=P6 に分離。
import { TruthStore } from "@ihl/truth";
import { fib } from "./ledger-routes";
import {
  CONTRIBUTION_PER_PLATINUM,
  CONTRIBUTION_TITLE_THRESHOLD,
  UPSTREAM_PERCENT,
} from "./economy-constants";

export const PT_TYPE = "ihl.economy.pt_event.v1";
export const CONTRIBUTION_TYPE = "ihl.economy.contribution_event.v1";

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
  return { actor_id: actorId, axes };
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
