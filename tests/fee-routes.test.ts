// L-PAY: 5%システム維持費のゆるい請求フロー TC (round-16 裁定・fee-routes.ts)。
// POST /fees/{obligation_id}/invoice(本人スコープ)・POST /fees/payjp-webhook(PUBLIC・
// charge id 再照会の2段構え・DI シームで fake connector を注入)・GET /me/fees(未払い投影・
// 期限超過ペナルティは発火しない=days_unpaid のみ)。既存義務台帳(gmo-obligation)を継承。
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { TruthStore, deriveActorId, deriveTransferCode, ulid } from "@ihl/truth";
import app from "../apps/api/src/index";
import { OBLIGATION_TYPE } from "../apps/api/src/gmo-routes";
import { createFeeRoutes, SETTLEMENT_TYPE } from "../apps/api/src/fee-routes";
import type { PayjpCharge, PayjpConnector } from "../apps/api/src/payjp-connector";
import type { Bindings, Variables } from "../apps/api/src/env";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

const JSON_HEADERS = { "content-type": "application/json" };
const DEV_ACTOR = await deriveActorId("dev@ihl.local");

async function seedObligation(
  s: TruthStore,
  opts: { actorId?: string; amount?: number; dueDate?: string; kind?: string } = {},
): Promise<string> {
  const id = ulid();
  const res = await s.putEvent({
    specversion: "1.0",
    id,
    source: "apps/api",
    type: OBLIGATION_TYPE,
    time: new Date().toISOString(),
    dataschema: "schemas/events/gmo-obligation.schema.json",
    provenance: { generator_kind: "agent", agent_name: "test" },
    data: {
      obligation_id: id,
      actor_id: opts.actorId ?? DEV_ACTOR,
      transfer_code: "U-TEST1",
      amount: opts.amount ?? 800,
      obligation_kind: opts.kind ?? "fee_tax",
      due_date: opts.dueDate ?? "2026-07-01T00:00:00Z",
      created_at: new Date().toISOString(),
      schema_version: "1",
    },
  });
  if (res.status !== "inserted") throw new Error(`seed obligation failed: ${res.status}`);
  return id;
}

describe("POST /api/v1/fees/{obligation_id}/invoice(本人スコープ・PAY.JP へは何も呼ばない)", () => {
  it("認証なし → 401", async () => {
    const res = await app.request("/api/v1/fees/x/invoice", { method: "POST" }, makeEnv());
    expect(res.status).toBe(401);
  });

  it("本人の義務 → 201・invoice_id + obligation_id を直接 merchant側ID として案内", async () => {
    const bucket = new FakeR2Bucket();
    const obligationId = await seedObligation(new TruthStore(bucket), { amount: 500 });
    const res = await app.request(
      `/api/v1/fees/${obligationId}/invoice`,
      { method: "POST", headers: AUTH_HEADERS },
      makeEnv(bucket),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      obligation_id: obligationId,
      amount: 500,
      status: "open",
      payjp_metadata_key: "obligation_id",
      // V3-MKT-12: 決定的コード(userId→SHA-256→uint24→Base36→U-prefix)を銀行振込
      // で払う人向けに案内する。CL-11 deriveTransferCode と同じ値。
      bank_transfer_code: await deriveTransferCode(DEV_ACTOR),
    });
  });

  it("存在しない義務 → 404", async () => {
    const res = await app.request(
      "/api/v1/fees/does-not-exist/invoice",
      { method: "POST", headers: AUTH_HEADERS },
      makeEnv(),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "OBLIGATION_NOT_FOUND" });
  });

  it("他人の義務 → 403", async () => {
    const bucket = new FakeR2Bucket();
    const other = await deriveActorId("attacker@ihl.local");
    const obligationId = await seedObligation(new TruthStore(bucket), { actorId: other });
    const res = await app.request(
      `/api/v1/fees/${obligationId}/invoice`,
      { method: "POST", headers: AUTH_HEADERS },
      makeEnv(bucket),
    );
    expect(res.status).toBe(403);
  });

  it("既に消込済みの義務 → 409 ALREADY_SETTLED", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    const obligationId = await seedObligation(s);
    await s.putEvent({
      specversion: "1.0",
      id: ulid(),
      source: "apps/api",
      type: SETTLEMENT_TYPE,
      time: new Date().toISOString(),
      dataschema: "schemas/events/fee-settlement.schema.json",
      provenance: { generator_kind: "agent", agent_name: "test" },
      data: {
        settlement_id: ulid(),
        obligation_id: obligationId,
        actor_id: DEV_ACTOR,
        charge_id: "ch_prepaid",
        amount: 800,
        matched_at: new Date().toISOString(),
        schema_version: "1",
      },
    });
    const res = await app.request(
      `/api/v1/fees/${obligationId}/invoice`,
      { method: "POST", headers: AUTH_HEADERS },
      makeEnv(bucket),
    );
    expect(res.status).toBe(409);
  });
});

describe("POST /api/v1/fees/payjp-webhook(PUBLIC・実 app に配線されている=非401)", () => {
  it("認証なしで到達可能(自己ゲート=charge再照会。不正 body は 400 で連続失敗しない)", async () => {
    const res = await app.request(
      "/api/v1/fees/payjp-webhook",
      { method: "POST", headers: JSON_HEADERS, body: "not json" },
      makeEnv(),
    );
    expect(res.status).toBe(400); // 401 ではない = PUBLIC_ROUTES 配線が効いている
    expect(await res.json()).toEqual({ error: "INVALID_WEBHOOK" });
  });
});

// fake connector を DI シームへ注入し、実 PAY.JP fetch なしで消込ロジックを直接検証。
function mountWithFakeConnector(charges: Record<string, PayjpCharge | null>) {
  const fake: PayjpConnector = {
    mode: "fake",
    async getCharge(id: string) {
      return charges[id] ?? null;
    },
  };
  const test = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  test.route("/api/v1", createFeeRoutes(() => fake));
  return test;
}

function charge(id: string, overrides: Partial<PayjpCharge> = {}): PayjpCharge {
  return { id, amount: 800, currency: "jpy", paid: true, captured: true, metadata: {}, ...overrides };
}

describe("payjp-webhook 消込ロジック(fake connector DI・2段構え=body ではなく再照会結果を信頼)", () => {
  it("paid charge + metadata.obligation_id 一致 → 201・settlement 冪等キー登録", async () => {
    const bucket = new FakeR2Bucket();
    const obligationId = await seedObligation(new TruthStore(bucket), { amount: 800 });
    const test = mountWithFakeConnector({
      ch_1: charge("ch_1", { metadata: { obligation_id: obligationId } }),
    });
    const body = JSON.stringify({ data: { object: { id: "ch_1" } } });
    const res = await test.request(
      "/api/v1/fees/payjp-webhook",
      { method: "POST", headers: JSON_HEADERS, body },
      makeEnv(bucket),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ok: true, obligation_id: obligationId, charge_id: "ch_1" });
  });

  it("同一 charge の webhook 再送 → 200 duplicate(冪等・put-if-absent 409 を吸収)", async () => {
    const bucket = new FakeR2Bucket();
    const obligationId = await seedObligation(new TruthStore(bucket), { amount: 800 });
    const test = mountWithFakeConnector({
      ch_2: charge("ch_2", { metadata: { obligation_id: obligationId } }),
    });
    const body = JSON.stringify({ data: { object: { id: "ch_2" } } });
    const first = await test.request("/api/v1/fees/payjp-webhook", { method: "POST", headers: JSON_HEADERS, body }, makeEnv(bucket));
    expect(first.status).toBe(201);
    const second = await test.request("/api/v1/fees/payjp-webhook", { method: "POST", headers: JSON_HEADERS, body }, makeEnv(bucket));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ ok: true, duplicate: true });
  });

  it("PAY.JP に存在しない charge id(webhook body を偽装しても) → 404・記録しない", async () => {
    const test = mountWithFakeConnector({}); // getCharge は常に null
    const body = JSON.stringify({ data: { object: { id: "ch_forged" } } });
    const res = await test.request("/api/v1/fees/payjp-webhook", { method: "POST", headers: JSON_HEADERS, body }, makeEnv());
    expect(res.status).toBe(404);
  });

  it("未払い(paid=false)は無視(202)・消込しない", async () => {
    const test = mountWithFakeConnector({ ch_3: charge("ch_3", { paid: false, metadata: { obligation_id: "OBL-X" } }) });
    const body = JSON.stringify({ data: { object: { id: "ch_3" } } });
    const res = await test.request("/api/v1/fees/payjp-webhook", { method: "POST", headers: JSON_HEADERS, body }, makeEnv());
    expect(res.status).toBe(202);
  });

  it("metadata.obligation_id 欠如 → 400(直接照合キーがない)", async () => {
    const test = mountWithFakeConnector({ ch_4: charge("ch_4", { metadata: {} }) });
    const body = JSON.stringify({ data: { object: { id: "ch_4" } } });
    const res = await test.request("/api/v1/fees/payjp-webhook", { method: "POST", headers: JSON_HEADERS, body }, makeEnv());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "MISSING_OBLIGATION_ID" });
  });

  it("metadata.obligation_id が義務台帳に存在しない → 404", async () => {
    const test = mountWithFakeConnector({ ch_5: charge("ch_5", { metadata: { obligation_id: "OBL-GHOST" } }) });
    const body = JSON.stringify({ data: { object: { id: "ch_5" } } });
    const res = await test.request("/api/v1/fees/payjp-webhook", { method: "POST", headers: JSON_HEADERS, body }, makeEnv());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "OBLIGATION_NOT_FOUND" });
  });
});

describe("GET /api/v1/me/fees(本人投影・未払い日数のみ・自動ペナルティなし)", () => {
  it("認証なし → 401", async () => {
    const res = await app.request("/api/v1/me/fees", {}, makeEnv());
    expect(res.status).toBe(401);
  });

  it("未払い1件(due_date過去)+ 消込済み1件 → 未払いのみ集計・days_unpaid > 0", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    const unpaidId = await seedObligation(s, { amount: 300, dueDate: "2020-01-01T00:00:00Z" });
    const paidId = await seedObligation(s, { amount: 700, dueDate: "2020-01-01T00:00:00Z" });
    await s.putEvent({
      specversion: "1.0",
      id: ulid(),
      source: "apps/api",
      type: SETTLEMENT_TYPE,
      time: new Date().toISOString(),
      dataschema: "schemas/events/fee-settlement.schema.json",
      provenance: { generator_kind: "agent", agent_name: "test" },
      data: {
        settlement_id: ulid(),
        obligation_id: paidId,
        actor_id: DEV_ACTOR,
        charge_id: "ch_paid",
        amount: 700,
        matched_at: new Date().toISOString(),
        schema_version: "1",
      },
    });

    const res = await app.request("/api/v1/me/fees", { headers: AUTH_HEADERS }, makeEnv(bucket));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      unpaid_total: number;
      unpaid_count: number;
      items: { obligation_id: string; paid: boolean; days_unpaid: number }[];
      bank_transfer_code: string;
    };
    expect(body.unpaid_total).toBe(300);
    expect(body.unpaid_count).toBe(1);
    const unpaidItem = body.items.find((i) => i.obligation_id === unpaidId);
    const paidItem = body.items.find((i) => i.obligation_id === paidId);
    expect(unpaidItem).toMatchObject({ paid: false });
    expect(unpaidItem!.days_unpaid).toBeGreaterThan(0); // 期限超過だが自動ペナルティは無い(投影のみ)
    expect(paidItem).toMatchObject({ paid: true, days_unpaid: 0 });
    // V3-MKT-12: 銀行振込コードは userId から決定的(deriveTransferCode と同一値)。
    expect(body.bank_transfer_code).toBe(await deriveTransferCode(DEV_ACTOR));
  });
});
