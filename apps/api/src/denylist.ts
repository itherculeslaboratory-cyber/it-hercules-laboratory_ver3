// V3-AUT-03 失効 denylist(round-16 Q-REQ-03: KVデニーリスト・MVP必須格上げ)。
// Workers KV に userId(actor_id)→失効時刻(epoch秒)を置き、index.ts の requireAuth
// ミドルウェアが毎リクエスト照会する(トークン iat < 失効時刻なら 401)。ステートレス
// セッション(V3-AUT-03本文)には server-side store が無いため、これが唯一の強制失効
// 経路 — これが無いと既発行トークンは exp(30日)まで生き続ける。
//
// 配線元(書込側): BAN(V3-KRM-04・karma_value 閾値越え)は ledger-routes.ts の
// grantKarmaCountIncrease が isBanned() 越えを検知した時に revokeActor を呼ぶ(全
// ペナルティ経路 — fee_unpaid/dispute/予約無反応/GOV-09 flag — が同じ関数を通るため
// 一箇所の guard で全経路をカバーする)。行政命令フラグ(V3-GOV-09)は gov-routes.ts の
// POST /gov/flags が閾値を跨がない場合でも無条件で追加 revoke する(行政命令には
// 従う=人間ゲート裁定済みの既存方針)。
//
// TTL = トークン最大寿命(SESSION_TTL)+ バッファ。失効時刻より後に issue された
// トークン(iat が上回る)は自然に denylist を通過する — BAN は可逆(KRM-04)という
// 既存思想と整合(value が回復して再ログインすれば新セッションは失効対象にならない)。
//
// V3-AUT-19(差し戻し是正・2026-07-31 lane-think裁定): 値を "<epoch>"(理由なし・旧形式)
// から "<epoch>|<reason>" へ後方互換で拡張する。理由に応じてゲート(index.ts)が
// 401 SESSION_REVOKED / 403 KARMA_SUSPENDED / 401 USER_NOT_FOUND を出し分ける
// (USER_NOT_FOUND は account_deleted の書き込み元が現時点で無いため予約のみ)。
// 旧形式の値は reason=null として読める — 既存の isDenylisted(boolean契約)呼び出し元・
// 既存テストは無改変で通る。
import { SESSION_TTL } from "./session";
import type { KVNamespaceLite } from "./kv";

const DENYLIST_TTL_S = SESSION_TTL + 24 * 60 * 60; // 30日 + 1日バッファ

/** V3-AUT-19: 失効理由コード。account_deleted は現行設計(append-only Truth・
 * ensureAccountのput-if-absent)では到達不能だが、テーブルの"席"として予約する。 */
export type RevokeReason = "karma_ban" | "account_deleted" | "gov_flag" | "manual";

/** actorId を即時失効登録。kv 未バインド(ローカル dev 等)は no-op — 機能全体を落とさない。
 * reason 省略時は旧形式("<epoch>"のみ)で書く(後方互換・既存呼び出し元は無改修で動く)。 */
export async function revokeActor(
  kv: KVNamespaceLite | undefined,
  actorId: string,
  at: number = Math.floor(Date.now() / 1000),
  reason?: RevokeReason,
): Promise<void> {
  if (!kv) return;
  await kv.put(actorId, reason ? `${at}|${reason}` : String(at), { expirationTtl: DENYLIST_TTL_S });
}

/**
 * V3-AUT-19: 失効判定+理由をまとめて返す。未登録/未バインドは {revoked:false, reason:null}。
 * ponytail: epoch秒(1秒粒度)なので iat===revokedAt の同一秒ケースが起こり得る —
 * 曖昧な同一秒は「失効側に倒す」(<=)。セキュリティ判定は寛容側でなく厳格側に倒す。
 */
export async function revocationOf(
  kv: KVNamespaceLite | undefined,
  actorId: string,
  iat: number,
): Promise<{ revoked: boolean; reason: RevokeReason | null }> {
  if (!kv) return { revoked: false, reason: null };
  const raw = await kv.get(actorId);
  if (raw === null) return { revoked: false, reason: null };
  const [atStr, reason] = raw.split("|");
  if (!(iat <= Number(atStr))) return { revoked: false, reason: null };
  return { revoked: true, reason: (reason as RevokeReason | undefined) ?? null };
}

/** 既存の boolean 契約は維持(単体テスト・他呼び出し元を壊さない)。 */
export async function isDenylisted(
  kv: KVNamespaceLite | undefined,
  actorId: string,
  iat: number,
): Promise<boolean> {
  return (await revocationOf(kv, actorId, iat)).revoked;
}
