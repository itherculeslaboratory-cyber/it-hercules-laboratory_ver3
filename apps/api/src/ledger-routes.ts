// 経済系 台帳 + カルマ二層(design-c4 §1 / V3-KRM-01・02・03 / CL-12)。
// 台帳は frozen ledger-entry 契約(karma_event / coin_event)の data を Truth
// append。残高・カルマ値は投影で都度再計算(常駐 DB 禁止・不変条項①)。
// 付与はサーバ内関数(観測 append 時のフックは C5 — 今回は付与関数 + 投影 + 本人スコープ route)。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { KARMA_VALUE_MIN, KARMA_VALUE_MAX } from "./economy-constants";

export const KARMA_TYPE = "ihl.economy.karma_event.v1";
export const COIN_TYPE = "ihl.economy.coin_event.v1";
const LEDGER_SCHEMA = "schemas/frozen/ledger-entry.schema.json";
const SCHEMA_VERSION = 1;

export const ledgerRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── Fibonacci カルマペナルティ(V3-KRM-02)────────────────────────────────
// カルマカウントが n-1→n に増えるたびカルマ値を -Fib(n) 減点。Fib(1)=Fib(2)=1。
export function fib(n: number): number {
  if (n <= 0) return 0;
  let a = 0;
  let b = 1; // Fib(1)
  for (let i = 1; i < n; i++) [a, b] = [b, a + b];
  return b;
}

// カウント from→to(from<to)の累積減点量(>=0)。初犯軽く累犯急増。
// 検算: fibPenalty(0,5)=12 / fibPenalty(5,10)=131(economy-constants アンカー)。
export function fibPenalty(fromCount: number, toCount: number): number {
  let sum = 0;
  for (let n = fromCount + 1; n <= toCount; n++) sum += fib(n);
  return sum;
}

const clampKarma = (v: number): number =>
  Math.min(KARMA_VALUE_MAX, Math.max(KARMA_VALUE_MIN, v));

// ── 投影(都度再計算)───────────────────────────────────────────────────
export interface LedgerProjection {
  actor_id: string;
  karma_value: number; // value 層 delta 合計を [-100,100] にクランプ
  karma_count: number; // count 層 delta 合計
  platinum_coins: number; // coin_event grant_amount 合計
}

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}

function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

// ponytail: 台帳2型を prefix scan + actor フィルタ = O(n) 全走査。MVP 量なら十分。
// 投影 index は C3+ の別波(design-c2 §3.1「一覧系投影は R2 prefix scan」)。
export async function projectLedger(
  s: TruthStore,
  actorId: string,
): Promise<LedgerProjection> {
  const karma = (await s.listEvents(`truth/${KARMA_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.actor_id === actorId); // 本人スコープ(V3-AUT-17): 他人分は投影に載らない
  const coins = (await s.listEvents(`truth/${COIN_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.actor_id === actorId);

  let value = 0;
  let count = 0;
  for (const d of karma) {
    const delta = typeof d.delta === "number" ? d.delta : 0;
    if (d.layer === "value") value += delta;
    else if (d.layer === "count") count += delta;
  }
  const platinum = coins.reduce(
    (a, d) => a + (typeof d.grant_amount === "number" ? d.grant_amount : 0),
    0,
  );
  return { actor_id: actorId, karma_value: clampKarma(value), karma_count: count, platinum_coins: platinum };
}

// ── 付与関数(サーバ内)─────────────────────────────────────────────────
function envelope(type: string, id: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type,
    time: new Date().toISOString(),
    dataschema: LEDGER_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}

async function appendKarma(
  s: TruthStore,
  actorId: string,
  layer: "value" | "count",
  delta: number,
  reason_code: string,
): Promise<void> {
  const id = ulid();
  const data: Record<string, unknown> = {
    karma_event_id: id,
    actor_id: actorId,
    layer,
    delta,
    reason_code,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  const res = await s.putEvent(envelope(KARMA_TYPE, id, actorId, data));
  if (res.status === "invalid") throw new Error(`karma append invalid: ${res.errors.join("; ")}`);
}

/**
 * カルマカウントを steps 進め、対応する Fibonacci 減点(V3-KRM-02)を value 層へ
 * append。現在カウントを投影で読んでから from→from+steps の累積 Fib を引く
 * (同一トランザクションの複数段は逐次適用と等価)。重大詐欺の一括 +5 等は
 * steps=5 で呼ぶ。append-only: value/count を別イベントとして 2 本 append。
 */
export async function grantKarmaCountIncrease(
  s: TruthStore,
  actorId: string,
  steps: number,
  reason_code: "dispute" | "fee_unpaid" | "manual" | "other" = "dispute",
): Promise<void> {
  if (!Number.isInteger(steps) || steps <= 0) throw new Error("steps must be a positive integer");
  const { karma_count } = await projectLedger(s, actorId);
  const penalty = fibPenalty(karma_count, karma_count + steps);
  await appendKarma(s, actorId, "count", steps, reason_code);
  await appendKarma(s, actorId, "value", -penalty, reason_code);
}

/** プラチナ功績章の付与(coin_event・付与のみ・grant_amount>=0)。 */
export async function grantPlatinum(
  s: TruthStore,
  actorId: string,
  amount: number,
  reason_code: "vote_reward" | "contribution_rebate" | "manual" | "other" = "vote_reward",
): Promise<void> {
  if (!(amount >= 0)) throw new Error("grant_amount must be >= 0");
  const id = ulid();
  const data = {
    coin_event_id: id,
    actor_id: actorId,
    grant_amount: amount,
    reason_code,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  const res = await s.putEvent(envelope(COIN_TYPE, id, actorId, data));
  if (res.status === "invalid") throw new Error(`coin append invalid: ${res.errors.join("; ")}`);
}

// ── route: GET /api/v1/me/ledger(本人スコープ・V3-AUT-17)──────────────
// 投影は必ずセッション principal で行う。他人の actor_id を渡す経路は無い。
ledgerRoutes.get("/me/ledger", async (c) => {
  const actorId = c.get("actorId");
  return c.json(await projectLedger(store(c), actorId));
});
