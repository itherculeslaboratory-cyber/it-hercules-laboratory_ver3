// V3-MKT-40: 市場台帳(ledger)の複式簿記検証。Truth は append-only(UPDATE/DELETE 禁止・
// 不変条項③)なので「複式簿記」を DB トリガーで持たず、正本イベントを都度再計算する検算
// バッチとして実装する(不変条項①・常駐 DB 禁止)。
//
// 貸方(credit)= ihl.economy.coin_event.v1(grantPlatinum・grant_amount>=0・system 側の
// サーバ内関数からのみ append=project-routes.ts の貢献還元・social-routes.ts の投票報酬・
// ledger-routes.ts の誤BAN復帰 karma のみが呼ぶ・クライアントが直接 amount を指定して
// 自己付与できる route は存在しない)。
// 借方(debit)= ihl.social.platinum_vote.v1(投票 coins・social-routes.ts projectCoinsSpent
// が正本)。残高 = 貸方累計(projectLedger.platinum_coins) − 借方累計(projectCoinsSpent)。
// 「idempotency_key の UNIQUE 制約」は Truth の putEvent(ULID キー・同一キー再 put 409)が
// 既に保証している(design-c2 §2 CL-01)ので、本バッチはその保証が実際に破れていないか
// (ULID 衝突等)を defensive に再確認するだけに留める(二重実装しない=reuse-first)。
import { Hono } from "hono";
import { TruthStore } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { KARMA_TYPE, COIN_TYPE, projectLedger } from "./ledger-routes";
import { VOTE_TYPE, projectCoinsSpent } from "./social-routes";

export const ledgerAuditRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

export interface NegativeBalanceRow {
  actor_id: string;
  granted: number; // projectLedger.platinum_coins(貸方累計)
  spent: number; // projectCoinsSpent(借方累計)
  balance: number; // granted - spent(0 未満は台帳破綻=バグ)
}

export interface LedgerAuditReport {
  accounts_checked: number;
  balanced: boolean; // negative_balance_actors が空 かつ duplicate_event_ids が空
  negative_balance_actors: NegativeBalanceRow[];
  duplicate_event_ids: string[]; // 本来 Truth の put-if-absent で発生し得ない(検知=重大バグ)
}

/** 複式簿記検算(純関数寄り・s のみ副作用読み取り)。全 actor を貸方/借方イベントから収集し、
 * 残高非負を確認する。都度再計算(常駐 DB 禁止・不変条項①)。 */
export async function auditLedger(s: TruthStore): Promise<LedgerAuditReport> {
  const coinEvents = (await s.listEvents(`truth/${COIN_TYPE}/`)).map(dataOf);
  const karmaEvents = (await s.listEvents(`truth/${KARMA_TYPE}/`)).map(dataOf);
  const voteEvents = (await s.listEvents(`truth/${VOTE_TYPE}/`)).map(dataOf);

  const actorIds = new Set<string>();
  for (const d of coinEvents) if (typeof d.actor_id === "string") actorIds.add(d.actor_id);
  for (const d of voteEvents) if (typeof d.voter_id === "string") actorIds.add(d.voter_id);

  const negative: NegativeBalanceRow[] = [];
  for (const actorId of actorIds) {
    const { platinum_coins } = await projectLedger(s, actorId);
    const spent = await projectCoinsSpent(s, actorId);
    const balance = platinum_coins - spent;
    if (balance < 0) negative.push({ actor_id: actorId, granted: platinum_coins, spent, balance });
  }

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const d of [...coinEvents, ...karmaEvents]) {
    const id = String(d.coin_event_id ?? d.karma_event_id ?? "");
    if (!id) continue;
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }

  return {
    accounts_checked: actorIds.size,
    balanced: negative.length === 0 && duplicates.size === 0,
    negative_balance_actors: negative,
    duplicate_event_ids: [...duplicates],
  };
}

// GET /ledger/audit — 検算バッチの都度実行(PROTECTED・全ログイン済みユーザー向けの
// システム全体健全性サマリ)。健全時(balanced=true)は negative_balance_actors=[] で
// 個々人の財務詳細は出ない。破綻検知時のみ該当 actor_id が診断のため列挙される(=バグ
// アラームであり通常運用では空であるべき)。哲学「信頼と信用と、透明性のあるログ」節に
// 沿い、隠さず出す。
ledgerAuditRoutes.get("/ledger/audit", async (c) => {
  return c.json(await auditLedger(store(c)));
});
