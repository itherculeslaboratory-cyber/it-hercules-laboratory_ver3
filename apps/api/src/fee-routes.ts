// L-PAY: 5%システム維持費のゆるい請求フロー(round-16 裁定・docs/planning/rulings/
// round-16-answers-raw.md 受領1〜7)。「取引成立→計算して振り込んでね」の請求ベースで、
// 期限超過の自動ペナルティは発火させない(取り逃し許容・既存カルマ機構は不変・不接続)。
// 決済手段=PAY.JP(第一弾。PayPay OPA は並行申請中で将来追加)。
//
// 既存の義務台帳(ihl.gmo.obligation.v1・gmo-routes.ts の OBLIGATION_TYPE)をそのまま継承
// する(型リネーム禁止・新イベント型は append の原則)。GMO の名前照合(U-code 正規表現)は
// 使わず、PAY.JP charge の metadata.obligation_id で「merchant側ID=義務ID直接照合」する
// (GMO 退役に伴う簡素化)。新イベント型: ihl.fee.invoice.v1(請求発行)/
// ihl.fee.settlement.v1(消込・charge_id put-if-absent で冪等)。
import { Hono } from "hono";
import { TruthStore, ulid, deriveTransferCode } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { OBLIGATION_TYPE, toObligation, safeKeyPart, type ObligationRec } from "./gmo-routes";
import {
  makePayjpConnector,
  parseChargeIdFromWebhook,
  type PayjpConnector,
  type CreateTenantParams,
} from "./payjp-connector";
import { loadTxns, TXN_TYPE, TXN_SCHEMA, TXN_SCHEMA_VERSION } from "./market-routes";
import { reduceMarket, isAllowedEdge } from "./market-settlement";

export const INVOICE_TYPE = "ihl.fee.invoice.v1";
export const SETTLEMENT_TYPE = "ihl.fee.settlement.v1";
const INVOICE_SCHEMA = "schemas/events/fee-invoice.schema.json";
const SETTLEMENT_SCHEMA = "schemas/events/fee-settlement.schema.json";
const SCHEMA_VERSION = "1";
const DAY_MS = 24 * 60 * 60 * 1000;

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

// 請求発行 = 利用者本人が発行(human)。actor_id は provenance に載せる(V3-AUT-17)。
function humanEnvelope(type: string, id: string, actorId: string, dataschema: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type,
    time: new Date().toISOString(),
    dataschema,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}
// 消込 = webhook 照合ジョブ(system)が生成(agent)。
function agentEnvelope(type: string, id: string, dataschema: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type,
    time: new Date().toISOString(),
    dataschema,
    provenance: { generator_kind: "agent", agent_name: "payjp-webhook" },
    data,
  };
}

// 義務台帳を obligation_id で O(1) 直読み(Truth キー層規約 = truth/<type>/<obligation_id>.json・
// gmo-obligation.schema.json 記載の layout)。listEvents による全件走査より軽い。
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

// ── routes ──────────────────────────────────────────────────────────────
// createFeeRoutes は ai-kernel.ts の createAiRoutes と同じ DI シーム: makeConnector を
// 差し替えて payjp-webhook を実 fetch なしでテストできる(index.ts は既定=makePayjpConnector
// を使う)。
export function createFeeRoutes(makeConnector: (env: Bindings) => PayjpConnector = makePayjpConnector) {
  const feeRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

  // POST /api/v1/fees/{obligation_id}/invoice — 請求発行(保護・本人スコープ)。
  // PAY.JP へは何も呼ばない(カードトークンはフロント専有情報でバックエンドに来ない・ゆるい
  // 請求=記録を発行するだけ)。obligation_id をそのまま merchant側IDとして案内する。
  feeRoutes.post("/fees/:obligation_id/invoice", async (c) => {
    const actorId = c.get("actorId");
    const obligationId = c.req.param("obligation_id");
    const s = store(c);

    const obligation = await loadObligation(s, obligationId);
    if (!obligation) return c.json({ error: "OBLIGATION_NOT_FOUND" }, 404);
    if (obligation.actor_id !== actorId) return c.json({ error: "FORBIDDEN" }, 403); // 本人スコープ

    if (await isSettled(s, obligationId)) {
      return c.json({ error: "ALREADY_SETTLED", obligation_id: obligationId }, 409);
    }

    const id = ulid();
    const data = {
      invoice_id: id,
      obligation_id: obligationId,
      actor_id: actorId,
      amount: obligation.amount,
      created_at: new Date().toISOString(),
      schema_version: SCHEMA_VERSION,
    };
    const res = await s.putEvent(humanEnvelope(INVOICE_TYPE, id, actorId, INVOICE_SCHEMA, data));
    if (res.status === "invalid") return c.json({ error: "INVALID", details: res.errors }, 400);
    if (res.status === "conflict") return c.json({ error: "DUPLICATE", key: res.key }, 409);
    return c.json(
      {
        invoice_id: id,
        obligation_id: obligationId,
        amount: obligation.amount,
        status: "open",
        // PAY.JP charge 作成時に metadata.obligation_id へこの値をそのまま載せる(U-code不使用)。
        payjp_metadata_key: "obligation_id",
        // V3-MKT-12: 銀行振込でゆる請求を払いたい人向けの案内(userId から決定的生成・
        // CL-11 deriveTransferCode)。振込名義にこのコードを含めてもらう(P2P/5%税で共用)。
        // 実際の入金確認は本人の pay_declare/pay_confirm 自己申告(市場側)で行い、この
        // コード自体の自動照合(旧 GMO 名前照合)は退役済み(index.ts gmo-routes コメント参照)。
        bank_transfer_code: await deriveTransferCode(actorId),
      },
      201,
    );
  });

  // POST /api/v1/fees/payjp-webhook — PAY.JP webhook 受領(PUBLIC・署名検証なし前提で
  // 自己ゲート: charge id を GET /v1/charges/:id で必ず再照会し、確認できた事実だけを信頼する
  // 2段構え。payjp-connector.ts 冒頭コメントに根拠明記)。
  feeRoutes.post("/fees/payjp-webhook", async (c) => {
    const rawBody = await c.req.text();
    const chargeId = parseChargeIdFromWebhook(rawBody);
    if (!chargeId) return c.json({ error: "INVALID_WEBHOOK" }, 400);

    const connector = makeConnector(c.env);
    const charge = await connector.getCharge(chargeId);
    if (!charge) return c.json({ error: "CHARGE_NOT_FOUND" }, 404);
    if (!charge.paid) return c.json({ ok: true, status: "unpaid_ignored" }, 202);

    const obligationId = charge.metadata.obligation_id;
    if (!obligationId) return c.json({ error: "MISSING_OBLIGATION_ID" }, 400);

    const s = store(c);
    const obligation = await loadObligation(s, obligationId);
    if (!obligation) return c.json({ error: "OBLIGATION_NOT_FOUND" }, 404);

    const id = ulid();
    const data = {
      settlement_id: id,
      obligation_id: obligationId,
      actor_id: obligation.actor_id,
      charge_id: charge.id,
      amount: charge.amount,
      matched_at: new Date().toISOString(),
      schema_version: SCHEMA_VERSION,
    };
    const key = `truth/${SETTLEMENT_TYPE}/${safeKeyPart(charge.id)}.json`;
    const res = await s.putEventAt(key, agentEnvelope(SETTLEMENT_TYPE, id, SETTLEMENT_SCHEMA, data));
    if (res.status === "invalid") return c.json({ error: "INVALID", details: res.errors }, 400);
    // 同一 charge の webhook 再送 = 冪等成功として 200(PAY.JP 側の再送リトライを止める)。
    if (res.status === "conflict") return c.json({ ok: true, duplicate: true, charge_id: charge.id }, 200);
    return c.json({ ok: true, settlement_id: id, obligation_id: obligationId, charge_id: charge.id }, 201);
  });

  // GET /api/v1/me/fees — 本人の未払い/支払い済み投影(保護・本人スコープ)。期限超過の
  // 自動ペナルティは発火させず、未払い日数を出すだけ(既存カルマ機構は変更しない・接続しない)。
  feeRoutes.get("/me/fees", async (c) => {
    const actorId = c.get("actorId");
    const s = store(c);

    const settledIds = new Set<string>();
    for (const d of (await s.listEvents(`truth/${SETTLEMENT_TYPE}/`)).map(dataOf)) {
      if (typeof d.obligation_id === "string") settledIds.add(d.obligation_id);
    }

    const now = Date.now();
    const items = (await s.listEvents(`truth/${OBLIGATION_TYPE}/`))
      .map(dataOf)
      .map(toObligation)
      .filter((o): o is ObligationRec => o !== null && o.actor_id === actorId)
      .map((o) => {
        const paid = settledIds.has(o.obligation_id);
        const dueMs = Date.parse(o.due_date);
        const days_unpaid =
          !paid && Number.isFinite(dueMs) ? Math.max(0, Math.floor((now - dueMs) / DAY_MS)) : 0;
        return {
          obligation_id: o.obligation_id,
          obligation_kind: o.obligation_kind,
          amount: o.amount,
          due_date: o.due_date,
          paid,
          days_unpaid,
        };
      })
      .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.obligation_id.localeCompare(b.obligation_id));

    const unpaid = items.filter((i) => !i.paid);
    return c.json({
      actor_id: actorId,
      unpaid_total: unpaid.reduce((a, i) => a + i.amount, 0),
      unpaid_count: unpaid.length,
      items,
      // V3-MKT-12: 銀行振込で払う人向けの案内コード(見出し欄・上の invoice と同じ導出)。
      bank_transfer_code: await deriveTransferCode(actorId),
    });
  });

  // ── V3-MKT-62/63: PAY.JP Platform(Payouts型)test-mode 結線 ──────────────────
  // round-16裁定(受領7)「両方作ってみて、最後ユーザーが選ぶ」= 銀行振込(既定・fee-routes
  // ゆる請求)に加え、PAY.JP Platform カード決済をオプションとして選べるようにする。
  // テナント本人確認(実際の銀行口座情報入力)自体は本人が行う行為であり AI の人間ゲートには
  // 当たらない — 人間ゲートは PAY.JP "本番"アカウント申込のみ(V3-MKT-15/round-16裁定)。
  // よって test モード API 呼び出しの結線はここまで進めてよい。

  // POST /api/v1/market/payjp/tenant — 呼び出し本人を PAY.JP テナント(売主)として test
  // モードで作成する(自己スコープ・保護)。tenant id はセッション principal から決定的に
  // 導出(safeId 形状に合わせ actor_id をそのまま使う・PAY.JP 側は英数字+アンダースコアのみ
  // 許容)。Truth への永続化はしない(カードトークンと同じくフロントエンド/本人が
  // tenant_id を保持し、出品時に添える運用=市場側の状態機械を増やさない・reuse-first)。
  feeRoutes.post("/market/payjp/tenant", async (c) => {
    const actorId = c.get("actorId");
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const required = [
      "bankAccountHolderName",
      "bankCode",
      "bankBranchCode",
      "bankAccountType",
      "bankAccountNumber",
    ] as const;
    for (const key of required) {
      if (!body || typeof body[key] !== "string" || !body[key]) {
        return c.json({ error: "INVALID_TENANT", details: [`${key} required`] }, 400);
      }
    }
    const tenantId = `ten_${actorId}`.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 255);
    const params: CreateTenantParams = {
      id: tenantId,
      name: typeof body?.name === "string" && body.name ? body.name : actorId,
      platformFeeRate: 0.05, // V3-MKT-63: 5%固定(economy-constants SETTLEMENT_ACCRUAL_RATE と同値)
      minimumTransferAmount: Number.isInteger(Number(body?.minimumTransferAmount)) ? Number(body?.minimumTransferAmount) : 1,
      bankAccountHolderName: String(body?.bankAccountHolderName),
      bankCode: String(body?.bankCode),
      bankBranchCode: String(body?.bankBranchCode),
      bankAccountType: String(body?.bankAccountType),
      bankAccountNumber: String(body?.bankAccountNumber),
    };
    try {
      const connector = makeConnector(c.env);
      const tenant = await connector.createTenant(params);
      return c.json({ tenant }, 201);
    } catch (err) {
      return c.json({ error: "PAYJP_TENANT_FAILED", details: [(err as Error).message] }, 502);
    }
  });

  // POST /api/v1/market/listings/{listing_id}/payjp-charge — 取引の落札者(matched buyer)が
  // PAY.JP Platform カードで支払う(V3-MKT-62 選択肢②)。charge 成功(paid)時、5%は
  // createPlatformCharge が platformFeeFor() で自動控除済み(V3-MKT-63)。取引状態機械へは
  // system actor(agent)が pay_confirm を deterministic key(charge id)で put-if-absent
  // する(settleNoPayCancel と同型の自己修復パターン・二重発火は 409→無視で自然に防げる)。
  // カードトークンはフロントエンド専有情報としてそのまま connector へ渡すだけでログしない
  // (payjp-connector.ts 冒頭コメントの方針を踏襲)。
  feeRoutes.post("/market/listings/:listing_id/payjp-charge", async (c) => {
    const listingId = c.req.param("listing_id");
    const actorId = c.get("actorId");
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const amount = Number(body?.amount);
    const card = typeof body?.card === "string" ? body.card : "";
    const tenant = typeof body?.tenant === "string" ? body.tenant : "";
    if (!(amount > 0) || !card || !tenant) {
      return c.json({ error: "INVALID_CHARGE", details: ["amount>0, card, tenant required"] }, 400);
    }

    const s = store(c);
    const events = await loadTxns(c, listingId);
    const cur = reduceMarket(listingId, events);
    if (cur.matched_with !== actorId) {
      return c.json({ error: "FORBIDDEN", details: ["matched buyer only"] }, 403);
    }
    if (!isAllowedEdge(cur.state, "pay_confirm")) {
      return c.json({ error: "ILLEGAL_TRANSITION", from: cur.state, kind: "pay_confirm" }, 409);
    }

    const connector = makeConnector(c.env);
    let charge: Awaited<ReturnType<PayjpConnector["createPlatformCharge"]>>;
    try {
      charge = await connector.createPlatformCharge({ amount, card, tenant });
    } catch (err) {
      return c.json({ error: "PAYJP_CHARGE_FAILED", details: [(err as Error).message] }, 502);
    }
    if (!charge.paid) return c.json({ error: "CHARGE_NOT_PAID", charge_id: charge.id }, 402);

    const id = ulid();
    const data: Record<string, unknown> = {
      transaction_event_id: id,
      listing_id: listingId,
      actor_id: "system:payjp-charge",
      kind: "pay_confirm",
      amount: charge.amount,
      payload: { method: "payjp_platform", charge_id: charge.id },
      created_at: new Date().toISOString(),
      schema_version: TXN_SCHEMA_VERSION,
    };
    const res = await s.putEventAt(`truth/${TXN_TYPE}/payjp-charge-${safeKeyPart(charge.id)}.json`, {
      specversion: "1.0",
      id,
      source: "apps/api",
      type: TXN_TYPE,
      time: new Date().toISOString(),
      dataschema: TXN_SCHEMA,
      provenance: { generator_kind: "agent", agent_name: "payjp-platform-charge" },
      data,
    });
    if (res.status === "invalid") return c.json({ error: "INVALID_TRANSITION", details: res.errors }, 400);
    if (res.status === "conflict") {
      return c.json({ ok: true, duplicate: true, charge_id: charge.id }, 200); // 冪等(同一 charge 再送)
    }
    return c.json(
      { listing_id: listingId, charge_id: charge.id, amount: charge.amount, platform_fee: charge.platform_fee },
      201,
    );
  });

  return feeRoutes;
}

// Default instance wired in index.ts (env-driven PAY.JP connector).
export const feeRoutes = createFeeRoutes();
