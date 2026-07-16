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
import { SESSION_TTL } from "./session";
import type { KVNamespaceLite } from "./kv";

const DENYLIST_TTL_S = SESSION_TTL + 24 * 60 * 60; // 30日 + 1日バッファ

/** actorId を即時失効登録。kv 未バインド(ローカル dev 等)は no-op — 機能全体を落とさない。 */
export async function revokeActor(
  kv: KVNamespaceLite | undefined,
  actorId: string,
  at: number = Math.floor(Date.now() / 1000),
): Promise<void> {
  if (!kv) return;
  await kv.put(actorId, String(at), { expirationTtl: DENYLIST_TTL_S });
}

/**
 * トークン発行時刻(iat)が失効時刻以前なら denylist 命中。未登録/未バインドは false。
 * ponytail: epoch秒(1秒粒度)なので iat===revokedAt の同一秒ケースが起こり得る —
 * 曖昧な同一秒は「失効側に倒す」(<=)。セキュリティ判定は寛容側でなく厳格側に倒す。
 */
export async function isDenylisted(
  kv: KVNamespaceLite | undefined,
  actorId: string,
  iat: number,
): Promise<boolean> {
  if (!kv) return false;
  const revokedAt = await kv.get(actorId);
  if (revokedAt === null) return false;
  return iat <= Number(revokedAt);
}
