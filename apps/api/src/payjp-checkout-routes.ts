// PAY.JP Checkout v2(外部リンク型決済・test-mode)route。2026-08-07裁定TDS-1 ifNo
// 「絶対に、Bがいい私のシステムでは絶対開発しない」に基づき、カード入力欄は自社で一切持たず
// PAY.JP がホストする決済ページへリダイレクトする方式のみを実装する(カード番号/CVC/
// 有効期限に相当する文字列はこのファイル・関連テストのどこにも書かない)。
//
// 用途は IHL → ユーザーへの「システム利用料(成約額の5%)」の請求であり、V3-MKT-62/63 の
// 買主→売主 P2P カード決済(2026-08-07裁定PAY-1により退役済み・fee-routes.ts 参照)とは別物。
//
// 金額の出所についての判断: この route が使う obligation.amount は、義務台帳(OBLIGATION_TYPE)
// の生成元である market-routes.ts:841 `const amount = Math.round(gross * FEE_MAINTENANCE_TAX_RATE);`
// で既に5%(FEE_MAINTENANCE_TAX_RATE = economy-constants.ts:31 = 0.05)を適用済みの確定債務額
// であり、ここで再度 5% を掛けると二重適用になる。よってこのファイルは 0.05 を書かない
// (ハードコードではなく「既に確定した金額をそのまま渡す」)。★SETTLEMENT_ACCRUAL_RATE
// (economy-constants.ts:17 = 0.05・gmo-routes.ts の accrued_total 投影と payjp-connector の
// Platform charge 専用レート)は別定数であり、現在たまたま同値なだけである。片方だけ
// 変更された場合はこの判断を再検証すること。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { OBLIGATION_TYPE, toObligation, safeKeyPart, type ObligationRec } from "./gmo-routes";
import {
  makePayjpConnector,
  parseCheckoutSessionIdFromWebhook,
  type PayjpConnector,
} from "./payjp-connector";

const SETTLEMENT_TYPE = "ihl.fee.settlement.v1";
const SETTLEMENT_SCHEMA = "schemas/events/fee-settlement.schema.json";
const SCHEMA_VERSION = "1";

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

async function loadObligation(s: TruthStore, obligationId: string): Promise<ObligationRec | null> {
  const raw = await s.readEvent(`truth/${OBLIGATION_TYPE}/${safeKeyPart(obligationId)}.json`);
  if (!raw) return null;
  return toObligation(dataOf(raw));
}

async function isSettled(s: TruthStore, obligationId: string): Promise<boolean> {
  for (const d of (await s.listEvents(`truth/${SETTLEMENT_TYPE}/`)).map(dataOf)) {
    if (d.obligation_id === obligationId) return true;
  }
  return false;
}

export function createPayjpCheckoutRoutes(
  makeConnector: (env: Bindings) => PayjpConnector = makePayjpConnector,
) {
  const routes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

  // POST /api/v1/fees/:obligation_id/checkout-session — 本人スコープ(保護)。自分の義務に
  // 対してのみ Checkout Session を作れる(fee-routes.ts の /invoice と同じ本人スコープ判定)。
  routes.post("/fees/:obligation_id/checkout-session", async (c) => {
    const actorId = c.get("actorId");
    const obligationId = c.req.param("obligation_id");
    const s = store(c);

    const obligation = await loadObligation(s, obligationId);
    if (!obligation) return c.json({ error: "OBLIGATION_NOT_FOUND" }, 404);
    if (obligation.actor_id !== actorId) return c.json({ error: "FORBIDDEN" }, 403);
    if (await isSettled(s, obligationId)) {
      return c.json({ error: "ALREADY_SETTLED", obligation_id: obligationId }, 409);
    }

    const origin = new URL(c.req.url).origin;
    const connector = makeConnector(c.env);
    try {
      const session = await connector.createCheckoutSession({
        amount: obligation.amount,
        currency: "jpy",
        productName: "IHL システム利用料",
        successUrl: `${origin}/fees/checkout-success?obligation_id=${encodeURIComponent(obligationId)}`,
        cancelUrl: `${origin}/fees/checkout-cancel?obligation_id=${encodeURIComponent(obligationId)}`,
        metadata: { obligation_id: obligationId },
      });
      return c.json({ checkout_url: session.url, session_id: session.id }, 201);
    } catch (err) {
      return c.json({ error: "PAYJP_CHECKOUT_FAILED", details: [(err as Error).message] }, 502);
    }
  });

  // POST /api/v1/fees/payjp-checkout-webhook — Checkout v2 完了通知(PUBLIC)。
  // 既存 v1 charge webhook(/fees/payjp-webhook)は「charge id で GET 再照会」という強い
  // 保証を持つが、Checkout v2 はセッション再照会 API を T2-A の一次資料で確認できなかった
  // (報告書「決められなかったこと」参照)。そのため、この route は X-Payjp-Webhook-Token
  // ヘッダの一致確認のみを信頼境界とする(v1 と同型の弱い保証であることを明記して選ぶ)。
  // amount 等の本文フィールドは一切使わない — obligation 側の既定金額のみを正とする。
  routes.post("/fees/payjp-checkout-webhook", async (c) => {
    const expected = c.env.PAYJP_WEBHOOK_TOKEN;
    const received = c.req.header("X-Payjp-Webhook-Token");
    if (!expected || !received || received !== expected) {
      return c.json({ error: "INVALID_WEBHOOK_TOKEN" }, 401);
    }

    const rawBody = await c.req.text();
    const parsed = parseCheckoutSessionIdFromWebhook(rawBody);
    if (!parsed) return c.json({ error: "INVALID_WEBHOOK" }, 400);
    if (parsed.type !== "checkout.session.completed") {
      return c.json({ ok: true, ignored: true, type: parsed.type }, 202);
    }
    if (!parsed.obligationId) return c.json({ error: "MISSING_OBLIGATION_ID" }, 400);

    // fee-settlement.schema.json の required(obligation_id/actor_id/charge_id/amount)を
    // 満たすため、webhook 本文からは obligation_id(ルーティング用)のみを使い、
    // actor_id/amount は自前の Truth Store(loadObligation)から取得する — webhook 本文の
    // amount は一切使わない(v1 webhook が GET 再照会で得た正真の charge オブジェクトだけを
    // 信頼するのと同じ設計意図。v2 は再照会 API が一次資料で確認できなかったための代替)。
    const s = store(c);
    const obligation = await loadObligation(s, parsed.obligationId);
    if (!obligation) return c.json({ error: "OBLIGATION_NOT_FOUND" }, 404);

    const id = ulid();
    const key = `truth/${SETTLEMENT_TYPE}/${safeKeyPart(`checkout-${parsed.id}`)}.json`;
    const res = await s.putEventAt(key, {
      specversion: "1.0",
      id,
      source: "apps/api",
      type: SETTLEMENT_TYPE,
      time: new Date().toISOString(),
      dataschema: SETTLEMENT_SCHEMA,
      provenance: { generator_kind: "agent", agent_name: "payjp-checkout-webhook" },
      data: {
        settlement_id: id,
        obligation_id: parsed.obligationId,
        actor_id: obligation.actor_id,
        charge_id: `checkout-${parsed.id}`,
        amount: obligation.amount,
        matched_at: new Date().toISOString(),
        schema_version: SCHEMA_VERSION,
      },
    });
    if (res.status === "invalid") return c.json({ error: "INVALID", details: res.errors }, 400);
    // 同一 checkout session の webhook 再送 = 冪等成功として 200(PAY.JP 側の再送を止める)。
    if (res.status === "conflict") {
      return c.json({ ok: true, duplicate: true, obligation_id: parsed.obligationId }, 200);
    }
    return c.json({ ok: true, settlement_id: id, obligation_id: parsed.obligationId }, 201);
  });

  return routes;
}

export const payjpCheckoutRoutes = createPayjpCheckoutRoutes();
