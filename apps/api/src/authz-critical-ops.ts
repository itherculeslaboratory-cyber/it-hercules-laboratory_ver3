// V3-AUT-32(design19 §T1-2)。重要操作(メール変更・削除・大きな取引等)のみ TOTP/2FA
// 二段階確認を要求する opt-in ゲート。TOTP 本体(enrollment/検証の3ルート)は w-aut2 が
// 別ファイル(auth-routes.ts)で持つ — ここに同居させない(発注書「V3-AUT-32」明記)。
// この層が持つのは「どのルートが重要操作か」の分類と、「直近の二段階確認が有効か」の
// 判定を挟むミドルウェアの骨格のみ。TOTP検証そのもの(秘密鍵の照合)は呼び手(w-aut2)が
// resolver 関数として渡す — 判定ロジックを持たせると同居になるため持たない。
import type { MiddlewareHandler } from "hono";
import type { Bindings, Variables } from "./env";

/** 要件逐語(design19 §T1-2)「メール変更・削除・大きな取引等の重要操作時のみ」から
 * 直接落ちる分類。新しい種別を増やす時はここに追記する。*/
export type CriticalOperation = "email_change" | "account_deletion" | "large_transaction";

/**
 * 重要操作ルートへ挟む二段階確認ゲート。`isSecondFactorVerified` は「直近の TOTP 確認が
 * 有効か」を返す resolver — 実体(seed 照合・有効期限)は w-aut2 が実装し、このミドルウェア
 * は判定結果を受け取って通す/落とすだけ(判定ロジックへの依存を持たない)。
 * 確認が無ければ 401 SECOND_FACTOR_REQUIRED(403 FORBIDDEN とは区別する — 権限が無いの
 * ではなく、追加の本人確認が要る状態のため)。
 */
export function requireSecondFactor(
  isSecondFactorVerified: (
    c: Parameters<MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }>>[0],
  ) => boolean | Promise<boolean>,
  op: CriticalOperation,
): MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> {
  return async (c, next) => {
    const ok = await isSecondFactorVerified(c);
    if (!ok) return c.json({ error: "SECOND_FACTOR_REQUIRED", op }, 401);
    return next();
  };
}
