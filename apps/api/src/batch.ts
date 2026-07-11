// C5 K3 月次 cron (design-k3 §2.6 / V3-KRM-03/11/12・V3-MKT-04/10)。単一
// handleScheduled を日次トリガ("0 15 * * *" = UTC15時 = JST0時)で受け、実処理は
// 毎月 RECOVERY_BASE_DAY(25 日)基準で月次分岐する。全ジョブは Truth の prefix-scan
// 投影から都度再計算し(常駐 DB 禁止・不変条項①)、書込は putEventAt の deterministic
// key(put-if-absent = storage 層強制)で「月内 at-most-once」を保証する。LLM 呼び出し
// なし。cron 宣言=常駐トークン消費の enabling でありデプロイ時に実行開始=人間ゲート
// (config/consented-crons.json の consent artifact + GATE 緑まで作り、デプロイはしない)。
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings } from "./env";
import {
  KARMA_TYPE,
  COIN_TYPE,
  projectLedger,
  grantKarmaCountIncrease,
  fib,
} from "./ledger-routes";
import { CONTRIBUTION_TYPE, AXES, type Axis, mintFromScore } from "./contribution";
import {
  reduceMarket,
  projectSettlement,
  type TxnEvent,
} from "./market-settlement";
import {
  MONTHLY_RECOVERY,
  RECOVERY_BASE_DAY,
  KARMA_VALUE_MAX,
  CONTRIBUTION_PER_PLATINUM,
  UPSTREAM_PERCENT,
} from "./economy-constants";

const LEDGER_SCHEMA = "schemas/frozen/ledger-entry.schema.json";
const TXN_TYPE = "ihl.mkt.transaction_event.v1";
const TXN_SCHEMA = "schemas/events/mkt-transaction-event.schema.json";
const RATING_TYPE = "ihl.mkt.rating.v1";
const RATING_SCHEMA = "schemas/events/mkt-rating.schema.json";

// cron が発行する自動/系統イベントの actor(V3-AUT-17: auto=true 自動良評価の系統 actor)。
const SYSTEM_ACTOR = "system:cron";

function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}
function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function sameUTCMonth(iso: unknown, now: Date): boolean {
  if (typeof iso !== "string") return false;
  const d = new Date(iso);
  return d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth();
}
function utcMonths(a: Date, b: Date): number {
  return b.getUTCFullYear() * 12 + b.getUTCMonth() - (a.getUTCFullYear() * 12 + a.getUTCMonth());
}

// ── envelope ビルダ(provenance は agent=cron・時刻は注入 now)─────────────
function agentProvenance() {
  return { generator_kind: "agent", agent_name: "claude-code" };
}
function karmaEnvelope(actorId: string, layer: "value" | "count", delta: number, reason: string, now: Date) {
  const id = ulid();
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: KARMA_TYPE,
    time: now.toISOString(),
    dataschema: LEDGER_SCHEMA,
    provenance: agentProvenance(),
    data: {
      karma_event_id: id,
      actor_id: actorId,
      layer,
      delta,
      reason_code: reason,
      created_at: now.toISOString(),
      schema_version: 1,
    },
  };
}
function coinEnvelope(actorId: string, amount: number, now: Date) {
  const id = ulid();
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: COIN_TYPE,
    time: now.toISOString(),
    dataschema: LEDGER_SCHEMA,
    provenance: agentProvenance(),
    data: {
      coin_event_id: id,
      actor_id: actorId,
      grant_amount: amount,
      reason_code: "contribution_rebate",
      created_at: now.toISOString(),
      schema_version: 1,
    },
  };
}
function txnEnvelope(actorId: string, data: Record<string, unknown>, now: Date) {
  const id = ulid();
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: TXN_TYPE,
    time: now.toISOString(),
    dataschema: TXN_SCHEMA,
    provenance: agentProvenance(),
    data,
  };
}

// ── KRM-03 月次カルマ救済 ────────────────────────────────────────────────
// 各 actor につき、当月 count 増加(違反)履歴があれば count-1(reason monthly_batch・
// value 救済なし)、無ければ(count=0 完遂)value +MONTHLY_RECOVERY(上限 KARMA_VALUE_MAX)。
// idempotency: 書込キーを (actor, 当月) 固定にして put-if-absent で月内 1 回に強制。
// cron は KRM-06 guard(value 正増加は monthly_batch のみ許可)を満たす唯一の正当経路
// なので、appendKarma を介さず直接 monthly_batch を書く(now 注入で created_at も正)。
export async function krmMonthlyRecovery(s: TruthStore, now: Date): Promise<void> {
  const karma = (await s.listEvents(`truth/${KARMA_TYPE}/`)).map(dataOf);
  const actors = [...new Set(karma.map((d) => d.actor_id).filter((a): a is string => typeof a === "string"))];
  for (const actor of actors) {
    const mine = karma.filter((d) => d.actor_id === actor);
    const violatedThisMonth = mine.some(
      (d) => d.layer === "count" && typeof d.delta === "number" && d.delta > 0 && sameUTCMonth(d.created_at, now),
    );
    const proj = await projectLedger(s, actor);
    let ev: ReturnType<typeof karmaEnvelope> | null = null;
    if (violatedThisMonth) {
      if (proj.karma_count > 0) ev = karmaEnvelope(actor, "count", -1, "monthly_batch", now); // 緩やかな count 回復
    } else {
      const recover = Math.min(MONTHLY_RECOVERY, KARMA_VALUE_MAX - proj.karma_value);
      if (recover > 0) ev = karmaEnvelope(actor, "value", recover, "monthly_batch", now);
    }
    if (!ev) continue;
    const key = `truth/${KARMA_TYPE}/krm03-${actor}-${monthKey(now)}.json`;
    await s.putEventAt(key, ev); // conflict = 当月処理済 = 冪等スキップ
  }
}

// ── KRM-12 各軸当月無ミント → 鋳造閾値 Fib 1 段降下(下限 100・残高非減衰)───────
// 当月にその軸の貢献(=ミント誘発)が無い dry 軸で、降下後閾値 max(100, 100*fib(minted))
// を carry が満たすなら救済プラチナ 1 枚を鋳造(加算のみ = 残高非減衰)。deterministic
// key で (actor, axis, 当月) に 1 回。ponytail: 「無ミント」は当月貢献イベント無しを
// proxy とする(軸別コイン鋳造の実配線は未実装 = 別波・貢献→スコアのみが確定資産)。
export async function krmDryAxisMercyMint(s: TruthStore, now: Date): Promise<void> {
  const contribs = (await s.listEvents(`truth/${CONTRIBUTION_TYPE}/`)).map(dataOf);
  const actors = [...new Set(contribs.map((d) => d.actor_id).filter((a): a is string => typeof a === "string"))];
  for (const actor of actors) {
    const mine = contribs.filter((d) => d.actor_id === actor);
    for (const axis of AXES) {
      const axisEvents = mine.filter((d) => (d.axis as Axis) === axis);
      if (axisEvents.length === 0) continue;
      if (axisEvents.some((d) => sameUTCMonth(d.created_at, now))) continue; // wet 軸 = 当月ミント有 → 降下なし
      const score = axisEvents.reduce(
        (a, d) => a + (typeof d.delta === "number" && d.delta > 0 ? d.delta : 0),
        0,
      );
      const { minted, carry } = mintFromScore(score);
      const lowered = Math.max(CONTRIBUTION_PER_PLATINUM, CONTRIBUTION_PER_PLATINUM * fib(minted)); // Fib 1 段降下・下限 100
      if (carry < lowered) continue;
      const key = `truth/${COIN_TYPE}/mercy-${actor}-${axis}-${monthKey(now)}.json`;
      await s.putEventAt(key, coinEnvelope(actor, 1, now));
    }
  }
}

// ── KRM-11 フォーク/投票プラチナ 10% を低レイヤー作者へ月次還元 ─────────────
// 当月の source∈{fork,vote} 貢献イベントで、source_ref を上流(低レイヤー)作者 ID と
// して 10%(UPSTREAM_PERCENT)を還元プラチナで付与。deterministic key で source
// イベント単位に 1 回。ponytail: 上流は source_ref 直参照(依存グラフ全走査ではない)・
// 還元原資は貢献 delta×10% で近似(fork/vote 別プラチナ台帳が無いため)= 明示ceiling。
export async function krmForkVoteRebate(s: TruthStore, now: Date): Promise<void> {
  const contribs = (await s.listEvents(`truth/${CONTRIBUTION_TYPE}/`)).map(dataOf);
  for (const d of contribs) {
    if (d.source !== "fork" && d.source !== "vote") continue;
    if (!sameUTCMonth(d.created_at, now)) continue; // 当月分のみ月次集計
    const upstream = typeof d.source_ref === "string" ? d.source_ref : "";
    if (!upstream) continue;
    const delta = typeof d.delta === "number" ? d.delta : 0;
    const rebate = Math.floor(delta * UPSTREAM_PERCENT);
    if (rebate < 1) continue;
    const srcId = String(d.contribution_event_id ?? "");
    const key = `truth/${COIN_TYPE}/rebate-${upstream}-${srcId}.json`;
    await s.putEventAt(key, coinEnvelope(upstream, rebate, now));
  }
}

// ── MKT-04 配送完了 + 30 日無評価 → 自動 grade:good, auto ─────────────────
// projectSettlement.auto_good_due(ship から AUTO_GOOD_RATING_DAYS 経過・未評価)の
// listing に、系統 actor 発の自動良評価(rating)と rate 取引イベントを append。両者
// deterministic key = 冪等。rate 追加で次回 ratedAt が定まり auto_good_due は false 化。
export async function mktAutoGoodRatings(s: TruthStore, now: Date): Promise<void> {
  const txns = (await s.listEvents(`truth/${TXN_TYPE}/`)).map(dataOf) as unknown as TxnEvent[];
  const listingIds = [...new Set(txns.map((t) => t.listing_id).filter((x): x is string => typeof x === "string"))];
  for (const listingId of listingIds) {
    const events = txns.filter((t) => t.listing_id === listingId);
    if (!projectSettlement(events, now).auto_good_due) continue;
    const cur = reduceMarket(listingId, events);
    const ratee = cur.seller_id; // 出品者への自動良評価(買い手が期限内に評価しない放置ケース)
    if (!ratee) continue;

    const rid = ulid();
    await s.putEventAt(`truth/${RATING_TYPE}/auto-${listingId}.json`, {
      specversion: "1.0",
      id: rid,
      source: "apps/api",
      type: RATING_TYPE,
      time: now.toISOString(),
      dataschema: RATING_SCHEMA,
      provenance: agentProvenance(),
      data: {
        rating_id: rid,
        listing_id: listingId,
        rater_id: SYSTEM_ACTOR,
        ratee_id: ratee,
        grade: "good",
        auto: true,
        created_at: now.toISOString(),
        schema_version: "1",
      },
    });

    const tid = ulid();
    await s.putEventAt(
      `truth/${TXN_TYPE}/auto-rate-${listingId}.json`,
      txnEnvelope(SYSTEM_ACTOR, {
        transaction_event_id: tid,
        listing_id: listingId,
        actor_id: SYSTEM_ACTOR,
        kind: "rate",
        payload: { auto: true, grade: "good" },
        created_at: now.toISOString(),
        schema_version: "1",
      }, now),
    );
  }
}

// ── MKT-10 fee_unpaid 成立月起算 月次 Fibonacci Δcount ────────────────────
// 成立(settled)かつ 8% 維持費税 未消込(fee_unpaid_started_at 有)の listing に、月
// 境界を跨ぐごと 1 段の Fibonacci Δcount を出品者へ課す(grantKarmaCountIncrease
// reason 'fee_unpaid' 再利用)。tax_pay 消込で fee_unpaid_started_at が消え Δcount 停止。
// deterministic な fee_unpaid marker(listing, 当月)を marker-first で put-if-absent し、
// at-most-once(クラッシュ時は 1 月スキップ・二重課金しない)を保証。
export async function mktFeeUnpaidPenalty(s: TruthStore, now: Date): Promise<void> {
  const txns = (await s.listEvents(`truth/${TXN_TYPE}/`)).map(dataOf) as unknown as TxnEvent[];
  const listingIds = [...new Set(txns.map((t) => t.listing_id).filter((x): x is string => typeof x === "string"))];
  for (const listingId of listingIds) {
    const events = txns.filter((t) => t.listing_id === listingId);
    const settlement = projectSettlement(events, now);
    if (!settlement.fee_unpaid_started_at) continue; // 未成立 or 消込済 → 課金なし(停止)
    if (utcMonths(new Date(settlement.fee_unpaid_started_at), now) < 1) continue; // 成立月起算・翌月境界から
    const debtor = reduceMarket(listingId, events).seller_id; // 維持費税の義務者 = 出品者
    if (!debtor) continue;

    const mid = ulid();
    const marker = await s.putEventAt(
      `truth/${TXN_TYPE}/feeunpaid-${listingId}-${monthKey(now)}.json`,
      txnEnvelope(SYSTEM_ACTOR, {
        transaction_event_id: mid,
        listing_id: listingId,
        actor_id: SYSTEM_ACTOR,
        kind: "fee_unpaid",
        created_at: now.toISOString(),
        schema_version: "1",
      }, now),
    );
    if (marker.status === "conflict") continue; // 当月課金済 = 冪等スキップ
    await grantKarmaCountIncrease(s, debtor, 1, "fee_unpaid"); // 1 段 Fib 減点(fibPenalty 連動)
  }
}

// 月次バッチ本体(全ジョブ)。now を注入して境界をテスト可能にする(純関数的)。ジョブ
// 単位で try/catch し、1 ジョブの失敗が他を巻き込まないようにする(cron 耐性)。
export async function runMonthlyBatch(s: TruthStore, now: Date): Promise<void> {
  const jobs: [string, () => Promise<void>][] = [
    ["krm03", () => krmMonthlyRecovery(s, now)],
    ["krm12", () => krmDryAxisMercyMint(s, now)],
    ["krm11", () => krmForkVoteRebate(s, now)],
    ["mkt04", () => mktAutoGoodRatings(s, now)],
    ["mkt10", () => mktFeeUnpaidPenalty(s, now)],
  ];
  for (const [name, run] of jobs) {
    try {
      await run();
    } catch (e) {
      console.error(`monthly batch job ${name} failed:`, e);
    }
  }
}

// Cloudflare Workers scheduled ハンドラ。日次起動を受け、実処理は毎月 25 日基準のみ。
export interface ScheduledEventLike {
  scheduledTime?: number;
  cron?: string;
}
export async function handleScheduled(
  event: ScheduledEventLike,
  env: Bindings,
  _ctx?: unknown,
): Promise<void> {
  const now = new Date(typeof event?.scheduledTime === "number" ? event.scheduledTime : Date.now());
  if (now.getUTCDate() !== RECOVERY_BASE_DAY) return; // 月次分岐: 25 日基準以外は no-op
  await runMonthlyBatch(new TruthStore(env.TRUTH), now);
}
