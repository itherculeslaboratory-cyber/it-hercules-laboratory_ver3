// retired 2026-07-17 round-16(個人事業主に GMO あおぞらネット銀行の本番 API が提供されない
// ことが公式確認済み)。routes は index.ts から非マウント(GMO退役・最小)。決済は
// PAY.JP(payjp-connector.ts / fee-routes.ts)へ移行 — fee-routes.ts は本ファイルの義務台帳
// (OBLIGATION_TYPE / toObligation)をそのまま継承する(型リネーム禁止・新イベント型は
// append・schemas/frozen と旧イベント型は不触)。本ファイルは読み取り互換・接続層/照合ジョブ
// 単体 TC(gmo-fifo/gmo-accrual/gmo-reconcile 等)維持のため残置(丸ごと削除しない)。
//
// GMO sunabar 照合(design-c4 §2 / CL-11 / V3-MKT-14). 名前照合ポーリング(Phase 1)。
// 期待入金イベント(human append)→ 単発照合ジョブ(明細 poll → 依頼人名から U-XXXX
// 抽出 → 期待と突合)→ 一致で照合台帳 append(itemKey で put-if-absent = 二重 409)。
// 台帳は Truth append-only、残高/最終照合時刻は投影で都度再計算(不変条項①/③)。
import { Hono } from "hono";
import { TruthStore, ulid, deriveTransferCode } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { SETTLEMENT_ACCRUAL_RATE } from "./economy-constants";
import {
  extractTransferCode,
  makeGmoConnector,
  type GmoConnector,
} from "./gmo-connector";

export const EXPECTED_TYPE = "ihl.gmo.expected_payment.v1";
export const RECON_TYPE = "ihl.gmo.reconciliation.v1";
export const OBLIGATION_TYPE = "ihl.gmo.obligation.v1"; // V3-MKT-12 義務台帳
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
// export: fee-routes.ts の charge_id/obligation_id キー化でも再利用(reuse-first)。
export function safeKeyPart(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, "_");
}

// ── 照合ジョブ(単発実行関数)────────────────────────────────────────────
export interface ReconcileResult {
  scanned: number; // poll した入金明細数
  matched: number; // 新規に台帳 append した数
  duplicates: number; // 既照合 itemKey(put-if-absent 409 で冪等スキップ)
  unmatched: number; // 依頼人名にコードなし or 未登録コード
}

// 義務台帳の1件(FIFO 消込の対象。同一 code 同額の複数 pending を due_date 昇順に消す)。
// export: fee-routes.ts(PAY.JP 5%請求フロー)が義務台帳をそのまま継承して読むために再利用。
export interface ObligationRec {
  obligation_id: string;
  actor_id: string;
  transfer_code: string;
  amount: number;
  obligation_kind: string;
  due_date: string; // RFC3339(消込は date 部で入金日と比較)
}

export function toObligation(d: Record<string, unknown>): ObligationRec | null {
  if (
    typeof d.obligation_id === "string" &&
    typeof d.actor_id === "string" &&
    typeof d.transfer_code === "string" &&
    typeof d.amount === "number" &&
    typeof d.due_date === "string"
  ) {
    return {
      obligation_id: d.obligation_id,
      actor_id: d.actor_id,
      transfer_code: d.transfer_code,
      amount: d.amount,
      obligation_kind: typeof d.obligation_kind === "string" ? d.obligation_kind : "fee_tax",
      due_date: d.due_date,
    };
  }
  return null;
}

// 期待入金 + 義務台帳の code→actor 表を作り、poll した各入金の依頼人名から U-XXXX を
// 抽出して突合。1 安定コードを 5%(round-15で8%から引き下げ) 税/PT/P2P で共用(MKT-12)。義務がある入金は義務発生日
// 以降で最古の未払いへ FIFO 消込し reconciliation に obligation_ref を刻む。一致は itemKey
// キーで append(同一明細の二重 append は storage 層 409=obligation の二重消込も防ぐ)。
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

  // 義務台帳を code 別に due_date 昇順で整列(FIFO 消込順)。義務由来 code も actor 解決へ。
  const obligations = (await s.listEvents(`truth/${OBLIGATION_TYPE}/`))
    .map(dataOf)
    .map(toObligation)
    .filter((o): o is ObligationRec => o !== null);
  const oblByCode = new Map<string, ObligationRec[]>();
  for (const o of obligations) {
    codeToActor.set(o.transfer_code, o.actor_id);
    const list = oblByCode.get(o.transfer_code) ?? [];
    list.push(o);
    oblByCode.set(o.transfer_code, list);
  }
  for (const list of oblByCode.values()) {
    list.sort((a, b) => a.due_date.localeCompare(b.due_date) || a.obligation_id.localeCompare(b.obligation_id));
  }

  // 既照合が消し込んだ義務(reconciliation.obligation_ref)。同一ラン内の消込も追記する。
  const consumed = new Set<string>();
  for (const d of (await s.listEvents(`truth/${RECON_TYPE}/`)).map(dataOf)) {
    if (typeof d.obligation_ref === "string") consumed.add(d.obligation_ref);
  }

  // 入金は振込日時(transactionDate)昇順で処理し、多入金でも FIFO を決定論に保つ。
  const deposits = [...(await connector.listDepositTransactions())].sort(
    (a, b) => a.transactionDate.localeCompare(b.transactionDate) || a.itemKey.localeCompare(b.itemKey),
  );
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
    // 義務発生日(date 部)以降で最古の未払いへ FIFO 消込(振込日 = transactionDate)。
    const oldest = (oblByCode.get(code) ?? []).find(
      (o) => !consumed.has(o.obligation_id) && o.due_date.slice(0, 10) <= dep.transactionDate,
    );
    const id = ulid();
    const data: Record<string, unknown> = {
      reconciliation_id: id,
      item_key: dep.itemKey,
      actor_id: actorId,
      transfer_code: code,
      amount: dep.amount,
      applicant_name: dep.applicantName,
      matched_at: new Date().toISOString(),
      schema_version: SCHEMA_VERSION,
    };
    if (oldest) data.obligation_ref = oldest.obligation_id;
    const key = `truth/${RECON_TYPE}/${safeKeyPart(dep.itemKey)}.json`;
    const res = await s.putEventAt(key, agentEnvelope(RECON_TYPE, id, data));
    if (res.status === "inserted") {
      result.matched++;
      if (oldest) consumed.add(oldest.obligation_id); // 二重消込防止(同一ラン内)
    } else if (res.status === "conflict") result.duplicates++;
    else throw new Error(`reconciliation append invalid: ${res.errors.join("; ")}`);
  }
  return result;
}

// 義務台帳の消込状態を投影(MKT-12)。code 別に due_date 昇順で paid/pending を返す
// (paid = reconciliation.obligation_ref に一致・都度再計算=常駐 DB 禁止)。
export interface ObligationStatus {
  obligation_id: string;
  actor_id: string;
  transfer_code: string;
  amount: number;
  obligation_kind: string;
  due_date: string;
  paid: boolean;
}

export async function projectObligations(
  s: TruthStore,
  transferCode: string,
): Promise<ObligationStatus[]> {
  const consumed = new Set<string>();
  for (const d of (await s.listEvents(`truth/${RECON_TYPE}/`)).map(dataOf)) {
    if (typeof d.obligation_ref === "string") consumed.add(d.obligation_ref);
  }
  return (await s.listEvents(`truth/${OBLIGATION_TYPE}/`))
    .map(dataOf)
    .map(toObligation)
    .filter((o): o is ObligationRec => o !== null && o.transfer_code === transferCode)
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.obligation_id.localeCompare(b.obligation_id))
    .map((o) => ({ ...o, paid: consumed.has(o.obligation_id) }));
}

// ── 照合台帳の投影(本人スコープ + 最終照合時刻)──────────────────────────
export interface ReconciliationMeta {
  actor_id: string;
  last_reconciled_at: string | null; // 系の最終照合成立時刻(スカラー)
  matched_count: number; // 本人の照合済 件数
  confirmed_total: number; // 本人の確認入金 合計(円)
  accrued_total: number; // V3-SEC-06 5%(round-15で8%から引き下げ) 積立(round(confirmed_total*rate)・都度再計算)
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
  const confirmed_total = mine.reduce(
    (a, d) => a + (typeof d.amount === "number" ? d.amount : 0),
    0,
  );
  return {
    actor_id: actorId,
    last_reconciled_at: last || null,
    matched_count: mine.length,
    confirmed_total,
    accrued_total: Math.round(confirmed_total * SETTLEMENT_ACCRUAL_RATE),
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
