// V3-FND-22(design35 §4・R64-6 bridge2担当): API統一エンベロープ(data/meta{requestId,timestamp}/error)。
// index.ts は全艦不可侵のため本モジュールは未マウント。mount行はHQへ報告書で提示しHQが適用する
// (「apps/api/src/(FND-22用の新規middlewareモジュール。index.tsは編集不可)」規約どおり)。
import type { Context, MiddlewareHandler } from "hono";
import { ulid } from "@ihl/truth";

export interface EnvelopeMeta {
  requestId: string;
  timestamp: string;
}

/** data/meta または error/meta のいずれかの形へ包んだ応答本体。 */
export type EnvelopeBody = { data: unknown; meta: EnvelopeMeta } | { error: unknown; meta: EnvelopeMeta };

/**
 * 純関数: 元のレスポンス本体(JSON.parse済み)と status から統一エンベロープを組み立てる。
 * status>=400 かつ本体が { error: ... } 形(既存 route の標準パターン)ならその error をそのまま
 * 引き継いで error エンベロープへ、それ以外は data エンベロープへ包む(既存本体は書き換えない)。
 */
export function wrapEnvelope(body: unknown, status: number, requestId: string): EnvelopeBody {
  const meta: EnvelopeMeta = { requestId, timestamp: new Date().toISOString() };
  if (status >= 400 && body !== null && typeof body === "object" && "error" in (body as Record<string, unknown>)) {
    return { error: (body as Record<string, unknown>).error, meta };
  }
  return { data: body, meta };
}

/**
 * 全 route の JSON 応答を統一エンベロープへ包む Hono middleware。既存 route は c.json(...) を
 * そのまま呼び続けてよい(応答形状は本 middleware が後段で包み直す)。JSON 以外の応答(バイナリ等)
 * は素通しする(壊さない)。
 */
export function responseEnvelope(): MiddlewareHandler {
  return async (c: Context, next) => {
    const requestId = ulid();
    await next();
    const contentType = c.res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return;
    let body: unknown;
    try {
      body = await c.res.clone().json();
    } catch {
      return; // 非JSON本体(壊さず素通し)。
    }
    const wrapped = wrapEnvelope(body, c.res.status, requestId);
    c.res = new Response(JSON.stringify(wrapped), { status: c.res.status, headers: c.res.headers });
  };
}
