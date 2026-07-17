// V3-CST-02: ランニングコスト透明性ダッシュボード(GET /api/v1/costs)。ログイン済み
// 全ユーザーが閲覧できる(アプリ全体が login-gated のため追加ロール制限なし)。
// Sakura VPS 費は config/running-costs.json の手動値(デプロイ時正本・
// consented-crons.json/economy-policy.csv と同じ規約 — ランタイム書込 API は持たない)。
// R2 使用量は Cloudflare API から取得を試みるが、この実装(fetchR2Usage)は
// CF_API_TOKEN/CF_ACCOUNT_ID が無ければ即 undefined を返し(ネットワーク呼び出しなし)、
// 呼び出しに失敗しても(実 Cloudflare アカウントでの疎通は本ランでは未検証)常に
// undefined へ degrade する — GET /costs は config の manual_override_yen へ
// フォールバックし、決して 500 にしない。
import { Hono } from "hono";
import type { Bindings, Variables } from "./env";
// 換算表(コスト単価)は config 正本(生成物でない)。JSON は esbuild/vitest ネイティブ
// loader で bundle(github-webhook-routes.ts と同じ規約)。
import runningCosts from "../../../config/running-costs.json";

export const costsRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

export interface R2Pricing {
  free_storage_gb: number;
  storage_yen_per_gb_month: number;
  free_class_a_ops_per_month: number;
  class_a_yen_per_million_ops: number;
  free_class_b_ops_per_month: number;
  class_b_yen_per_million_ops: number;
}
export interface RunningCostsConfig {
  currency: string;
  vps: { label: string; monthly_yen: number; source: string };
  r2: { manual_override_yen: number; pricing: R2Pricing };
}
export interface R2Usage {
  storage_gb: number;
  class_a_ops: number;
  class_b_ops: number;
}
export interface CostsSummary {
  currency: string;
  vps: { label: string; monthly_yen: number; source: string };
  r2: { monthly_yen: number; source: "api" | "manual"; usage?: R2Usage };
  total_monthly_yen: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Pure: yen/month for R2 given usage + configured pricing (free tier subtracted, floor 0). */
export function computeR2Cost(usage: R2Usage, pricing: R2Pricing): number {
  const billableStorage = Math.max(0, usage.storage_gb - pricing.free_storage_gb);
  const billableA = Math.max(0, usage.class_a_ops - pricing.free_class_a_ops_per_month);
  const billableB = Math.max(0, usage.class_b_ops - pricing.free_class_b_ops_per_month);
  return (
    billableStorage * pricing.storage_yen_per_gb_month +
    (billableA / 1_000_000) * pricing.class_a_yen_per_million_ops +
    (billableB / 1_000_000) * pricing.class_b_yen_per_million_ops
  );
}

/** Pure: build the visible summary. r2Usage=undefined → manual_override_yen fallback. */
export function computeCostsSummary(
  config: RunningCostsConfig,
  r2Usage?: R2Usage,
): CostsSummary {
  const r2Yen = r2Usage ? computeR2Cost(r2Usage, config.r2.pricing) : config.r2.manual_override_yen;
  const r2: CostsSummary["r2"] = r2Usage
    ? { monthly_yen: round2(r2Yen), source: "api", usage: r2Usage }
    : { monthly_yen: round2(r2Yen), source: "manual" };
  return {
    currency: config.currency,
    vps: config.vps,
    r2,
    total_monthly_yen: round2(config.vps.monthly_yen + r2Yen),
  };
}

// ponytail: the real Cloudflare GraphQL Analytics query (r2StorageAdaptiveGroups /
// r2OperationsAdaptiveGroups) needs a live account to validate its exact response
// shape — not available in this run (no CF_API_TOKEN). Rather than ship a network
// call whose parsed result would be guessed/untested, this seam degrades to
// undefined for now; wiring the verified query is the human-gate follow-up
// (docs/architecture/external-adapter-nfr.md). GET /costs always falls back to
// the manual figure in the meantime — it never 500s on a missing/failed R2 call.
async function fetchR2Usage(env: Bindings): Promise<R2Usage | undefined> {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) return undefined;
  return undefined; // real GraphQL query: deferred (see comment above)
}

costsRoutes.get("/costs", async (c) => {
  const usage = await fetchR2Usage(c.env);
  return c.json(computeCostsSummary(runningCosts as RunningCostsConfig, usage));
});
