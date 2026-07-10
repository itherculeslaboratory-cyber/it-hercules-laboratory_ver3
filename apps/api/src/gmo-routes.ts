// GMO sunabar 照合(design-c4 §2 / CL-11 / V3-MKT-14). 名前照合ポーリング(Phase 1)。
// 期待入金イベント(human append)→ 単発照合ジョブ(明細 poll → 依頼人名から U-XXXX
// 抽出 → 期待と突合)→ 一致で照合台帳 append(itemKey で put-if-absent = 二重 409)。
// 台帳は Truth append-only、残高/最終照合時刻は投影で都度再計算(不変条項①/③)。
import { Hono } from "hono";
import { TruthStore, ulid, deriveTransferCode } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import {
  extractTransferCode,
  makeGmoConnector,
  type GmoConnector,
} from "./gmo-connector";

export const EXPECTED_TYPE = "ihl.gmo.expected_payment.v1";
export const RECON_TYPE = "ihl.gmo.reconciliation.v1";
const SCHEMA_VERSION = 1;

export const gmoRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

// 期待入金 = 利用者本人が発行(human)。actor_id は provenance に載せる(V3-AUT-17)。
function humanEnvelope(type: string, id: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type,
    time: new Date().toISOString(),
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}
// 照合台帳 = 照合ジョブ(system)が生成(agent)。payer の actor_id は data 側に持つ。
function agentEnvelope(type: string, id: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type,
    time: new Date().toISOString(),
    provenance: { generator_kind: "agent", agent_name: "gmo-reconcile" },
    data,
  };
}

// itemKey を Truth キーへ埋める前の無害化(prefix 破壊・パス注入の防止)。
// sunabar の itemKey は数値/英数だが、外部由来値なので許容集合に閉じる。
function safeKeyPart(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, "_");
}

// ── 照合ジョブ(単発実行関数)────────────────────────────────────────────
export interface ReconcileResult {
  scanned: number; // poll した入金明細数
  matched: number; // 新規に台帳 append した数
  duplicates: number; // 既照合 itemKey(put-if-absent 409 で冪等スキップ)
  unmatched: number; // 依頼人名にコードなし or 未登録コード
}

// 期待入金の code→actor 表を作り、poll した各入金の依頼人名から U-XXXX を抽出して
// 突合。一致は itemKey キーで append(同一明細の二重 append は storage 層 409)。
export async function reconcileOnce(
  s: TruthStore,
  connector: GmoConnector,
): Promise<ReconcileResult> {
  const expected = (await s.listEvents(`truth/${EXPECTED_TYPE}/`)).map(dataOf);
  const codeToActor = new Map<string, string>();
  for (const d of expected) {
    if (typeof d.transfer_code === "string" && typeof d.actor_id === "string") {
      codeToActor.set(d.transfer_code, d.actor_id); // code は actor から導出=一意
    }
  }

  const deposits = await connector.listDepositTransactions();
  const result: ReconcileResult = {
    scanned: deposits.length,
    matched: 0,
    duplicates: 0,
    unmatched: 0,
  };
  for (const dep of deposits) {
    const code = extractTransferCode(dep.applicantName);
    const actorId = code ? codeToActor.get(code) : undefined;
    if (!code || !actorId) {
      result.unmatched++;
      continue;
    }
    const id = ulid();
    const data = {
      reconciliation_id: id,
      item_key: dep.itemKey,
      actor_id: actorId,
      transfer_code: code,
      amount: dep.amount,
      applicant_name: dep.applicantName,
      matched_at: new Date().toISOString(),
      schema_version: SCHEMA_VERSION,
    };
    const key = `truth/${RECON_TYPE}/${safeKeyPart(dep.itemKey)}.json`;
    const res = await s.putEventAt(key, agentEnvelope(RECON_TYPE, id, data));
    if (res.status === "inserted") result.matched++;
    else if (res.status === "conflict") result.duplicates++;
    else throw new Error(`reconciliation append invalid: ${res.errors.join("; ")}`);
  }
  return result;
}

// ── 照合台帳の投影(本人スコープ + 最終照合時刻)──────────────────────────
export interface ReconciliationMeta {
  actor_id: string;
  last_reconciled_at: string | null; // 系の最終照合成立時刻(スカラー)
  matched_count: number; // 本人の照合済 件数
  confirmed_total: number; // 本人の確認入金 合計(円)
  confirmed_deposits: {
    item_key: string;
    amount: number;
    transfer_code: string;
    applicant_name: string;
    matched_at: string;
  }[];
}

export async function projectReconciliation(
  s: TruthStore,
  actorId: string,
): Promise<ReconciliationMeta> {
  const all = (await s.listEvents(`truth/${RECON_TYPE}/`)).map(dataOf);
  let last = "";
  for (const d of all) {
    const t = typeof d.matched_at === "string" ? d.matched_at : "";
    if (t > last) last = t;
  }
  const mine = all.filter((d) => d.actor_id === actorId); // 本人スコープ(V3-AUT-17)
  return {
    actor_id: actorId,
    last_reconciled_at: last || null,
    matched_count: mine.length,
    confirmed_total: mine.reduce(
      (a, d) => a + (typeof d.amount === "number" ? d.amount : 0),
      0,
    ),
    confirmed_deposits: mine.map((d) => ({
      item_key: String(d.item_key),
      amount: typeof d.amount === "number" ? d.amount : 0,
      transfer_code: String(d.transfer_code),
      applicant_name: String(d.applicant_name),
      matched_at: String(d.matched_at),
    })),
  };
}

// ── routes(全て本人スコープ・保護)──────────────────────────────────────
// GET /api/v1/gmo/transfer-code — 自分の振込コード(凍結 deriveTransferCode)。
gmoRoutes.get("/gmo/transfer-code", async (c) => {
  const actorId = c.get("actorId");
  return c.json({ transfer_code: await deriveTransferCode(actorId) });
});

// POST /api/v1/gmo/expected-payment — 期待入金イベント append。
// body.amount 任意(正数のみ採用・その他は null=金額不問)。
gmoRoutes.post("/gmo/expected-payment", async (c) => {
  const actorId = c.get("actorId");
  const body = (await c.req.json().catch(() => ({}))) as { amount?: unknown };
  const n = Number(body.amount);
  const amount = Number.isFinite(n) && n > 0 ? n : null;
  const transfer_code = await deriveTransferCode(actorId);
  const id = ulid();
  const data = {
    expected_payment_id: id,
    actor_id: actorId,
    transfer_code,
    amount,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  const res = await store(c).putEvent(humanEnvelope(EXPECTED_TYPE, id, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE", key: res.key }, 409);
  return c.json({ expected_payment_id: id, transfer_code, amount }, 201);
});

// GET /api/v1/gmo/reconciliation/meta — 本人の照合台帳投影 + 最終照合時刻。
gmoRoutes.get("/gmo/reconciliation/meta", async (c) => {
  const actorId = c.get("actorId");
  return c.json(await projectReconciliation(store(c), actorId));
});

// 参考: reconcileOnce は route ではなくサーバ内関数(単発ジョブ/バッチから呼ぶ)。
// 定期実行(Cron/Queue)配線は C5(本波は関数 + TC + 実 sunabar 疎通まで)。
export { makeGmoConnector };
