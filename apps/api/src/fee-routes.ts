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
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { OBLIGATION_TYPE, toObligation, safeKeyPart, type ObligationRec } from "./gmo-routes";
import { makePayjpConnector, parseChargeIdFromWebhook, type PayjpConnector } from "./payjp-connector";

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
    });
  });

  return feeRoutes;
}

// Default instance wired in index.ts (env-driven PAY.JP connector).
export const feeRoutes = createFeeRoutes();
