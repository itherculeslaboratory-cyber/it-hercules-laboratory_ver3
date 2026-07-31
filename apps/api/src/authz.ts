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

// design35 §3 A-4(統一authz・案A採用)。role語彙が3系統(AUT-22/26/28)に見えたのは
// 実は別の軸だった、という設計結論をそのまま型にする。③公開範囲(public/private+
// ドメイン固有拡張)は各ドメインスキーマ側の仕事であり統一しない設計のため、ここには
// 置かない(design35本文参照)。
/** ①システムロール(世界に対する立場)。AUT-22(第20回裁定)で確定した語彙のみ。
 * `requireRole` は任意文字列で動く既存の機構だが、この型は「値の集合」を固定するために
 * 別途置く(requireRole 自体のシグネチャは変えない=既存呼び出し元への非破壊)。*/
export type SystemRole = "operator" | "administrator";

/** ②リソースロール(1つのノードに対する立場)。AUT-26「共同編集は画面テンプレートに
 * 限定する」により、editor が意味を持つのは画面テンプレート(fork)のみ — 他ノードは
 * owner/viewer の2値で足りる(design35本文参照)。*/
export type ResourceRole = "owner" | "editor" | "viewer";

/**
 * ②リソースロールを検証するミドルウェア。`requireRole`(①システムロール用・
 * c.get("roles") 固定)とは判定元が異なる — リソースロールは「呼び手が対象ノードに
 * 対して何者か」であり、リクエストごとに解決が要るため、呼び手が resolver 関数を渡す
 * 形にする(新規スキーマ0本・新規権限概念0)。resolver が null を返す(=対象ノードに
 * 対して何のロールも持たない)場合は 403。
 */
export function requireResourceRole(
  resolveRole: (
    c: Parameters<MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }>>[0],
  ) => ResourceRole | null | Promise<ResourceRole | null>,
  ...allowed: ResourceRole[]
): MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> {
  return async (c, next) => {
    const role = await resolveRole(c);
    if (role && allowed.includes(role)) return next();
    return c.json({ error: "FORBIDDEN" }, 403);
  };
}
