// V3-SEC-14(ログイン系レート制限)+ V3-SEC-58(書込系レート制限+ユーザー別クォータ)共有の
// 固定ウィンドウカウンタ。単一 Workers KV Binding(RATE_LIMIT)をキー接頭辞で使い分ける。
// 新規 KV namespace の実 wrangler 作成は人間ゲート(HANDOFF §4)— 本ファイルは既存
// AUTH_DENYLIST/AUTH_CODE_STATE(env.ts)と同じ規約で、未バインド時は no-op(常に許可)に
// degrade する。ローカル/テストは memoryKV() を渡せば実際にカウントされる。
// R65-14是正(批評ゲート重大2): ★現時点(2026-07-31)では apps/api/wrangler.toml に
// `[[kv_namespaces]] binding="RATE_LIMIT"` の宣言が1つも無いため、本番デプロイでは
// `c.env.RATE_LIMIT` が undefined になり、下記 checkRateLimit は常に no-op(allowed=true)
// で実質「未実装」と同じ挙動になる。テストが緑なのはテスト側が RATE_LIMIT: memoryKV() を
// 注入しているから ── 「テストで実装済み」と「本番で有効」を同一視しない。KV namespace の
// 実作成・wrangler.toml へのbinding追加は人間ゲート(艦はwrangler.tomlを編集しない)。
// ponytail: 固定ウィンドウ(fixed window)カウンタ — ウィンドウ境界を跨ぐと理論上最大2倍の
// バーストを許す既知の誤差(スライディングウィンドウ/トークンバケットより単純)。乱用が実測
// されたら昇格する。キーに window bucket を埋め込むことで TTL 失効=自然なウィンドウ切替。
import type { KVNamespaceLite } from "./kv";

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
}

/**
 * key(呼び出し側が bucket を含めて一意化する)ごとの固定ウィンドウカウンタ。
 * kv 未バインドなら常に allowed=true(機能degrade・落ちない)。
 */
export async function checkRateLimit(
  kv: KVNamespaceLite | undefined,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  if (!kv) return { allowed: true, count: 0, limit };
  const raw = await kv.get(key);
  const count = raw ? parseInt(raw, 10) || 0 : 0;
  if (count >= limit) return { allowed: false, count, limit };
  await kv.put(key, String(count + 1), { expirationTtl: windowSeconds });
  return { allowed: true, count: count + 1, limit };
}

/** CF-Connecting-IP(本番)/ X-Forwarded-For(先頭)/ "unknown"(どちらも無い=テスト等)。 */
export function clientIp(req: { header(name: string): string | undefined }): string {
  const cf = req.header("CF-Connecting-IP");
  if (cf) return cf;
  const xff = req.header("X-Forwarded-For");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

// ── V3-SEC-58 書込系レート制限+ユーザー別クォータ(較正knob・運用実測で調整) ──────
// 1分あたりの書込(POST/PUT/PATCH/DELETE)上限/actor。暴走スクリプトのバーストを止める。
export const WRITE_RATE_LIMIT_PER_MINUTE = 60;
// 1日あたりの書込上限/actor。コスト膨張(R2 put課金)と Truth 汚染を防ぐ日次クォータ。
export const WRITE_QUOTA_PER_DAY = 5000;
