// PII セッション route(route 045・V3-SEC-07)。index.ts で app.route("/api/v1", …)
// にマウント → 最終パス /api/v1/settings/pii-session(route-matrix.csv infra-route-045)。
// protected(PUBLIC_ROUTES に入れない = deny-by-default)。
//
// 非永続: maskPii を呼び返すだけで Truth へは一切 append しない。生 PII をどこにも
// 保存しない = 「マスク前保存禁止」を構造的に充足(セッション限定の投影)。
import { Hono } from "hono";
import type { Bindings, Variables } from "./env";
import { maskPii } from "./pii.mjs";

export const piiRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// POST /settings/pii-session — { text } → { masked, findings, count }。永続なし。
piiRoutes.post("/settings/pii-session", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { text?: unknown } | null;
  if (!body || typeof body.text !== "string") {
    return c.json({ error: "INVALID_TEXT" }, 400);
  }
  const { masked, findings } = maskPii(body.text);
  return c.json({ masked, findings, count: findings.length });
});
