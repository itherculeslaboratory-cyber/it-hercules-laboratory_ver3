// ロール中間層(V3-AUT-22・機構のみ)。requireRole のみ — taxonomy 非依存(任意
// ロール文字列で動く)。本波はどの route にも attach しない(統一ロール体系の人間
// 裁定まで保留)。requireCapability / caps チャネルは呼び手が出る波で追加(YAGNI)。
import type { MiddlewareHandler } from "hono";
import type { Bindings, Variables } from "./env";

/**
 * c.get("roles") に allowed のいずれも無ければ 403 FORBIDDEN、有れば next()。
 */
export function requireRole(
  ...allowed: string[]
): MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> {
  return async (c, next) => {
    const roles = c.get("roles") ?? [];
    if (allowed.some((r) => roles.includes(r))) return next();
    return c.json({ error: "FORBIDDEN" }, 403);
  };
}
