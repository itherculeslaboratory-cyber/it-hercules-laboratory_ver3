import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { deriveActorId } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { sendMagicLink } from "./mail";
import {
  SESSION_TTL,
  issueMagicToken,
  issueSessionToken,
  verifyMagicToken,
  verifySessionToken,
} from "./session";

// email 正規化は入口で統一（第6回裁定③）。deriveActorId 自体は raw 有意のまま凍結。
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function bearerToken(auth: string | undefined): string {
  const h = auth ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

export const authRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// POST /magic-link (公開): email → magic token → mail. 202 { sent:true }.
authRoutes.post("/magic-link", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { email?: unknown } | null;
  if (!body || typeof body.email !== "string" || !body.email.includes("@")) {
    return c.json({ error: "INVALID_EMAIL" }, 400);
  }
  const email = normalizeEmail(body.email);
  const token = await issueMagicToken(email, c.env.SESSION_SECRET);
  await sendMagicLink(c.env, email, token);
  const res: Record<string, unknown> = { sent: true };
  if (c.env.IHL_DEV_EXPOSE_MAGIC_TOKEN === "1") res.dev_magic_token = token;
  return c.json(res, 202);
});

// POST /verify (公開): magic token → session token + Set-Cookie. { actor_id }.
authRoutes.post("/verify", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { token?: unknown } | null;
  if (!body || typeof body.token !== "string") {
    return c.json({ error: "INVALID_TOKEN" }, 401);
  }
  const payload = await verifyMagicToken(body.token, c.env.SESSION_SECRET);
  if (!payload) return c.json({ error: "INVALID_TOKEN" }, 401);
  const actorId = await deriveActorId(payload.email); // email already normalized at magic-link entry
  const session = await issueSessionToken(actorId, c.env.SESSION_SECRET);
  setCookie(c, "ihl_session", session, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
  return c.json({ actor_id: actorId });
});

// GET /session (公開): reports auth state, never 401.
authRoutes.get("/session", async (c) => {
  const token = getCookie(c, "ihl_session") ?? bearerToken(c.req.header("Authorization"));
  const payload = token ? await verifySessionToken(token, c.env.SESSION_SECRET) : null;
  if (!payload) return c.json({ authenticated: false });
  return c.json({ authenticated: true, actor_id: payload.sub });
});

// POST /logout (保護): clear cookie (Max-Age=0). Stateless — no server-side purge.
authRoutes.post("/logout", (c) => {
  deleteCookie(c, "ihl_session", { path: "/" });
  return c.json({ ok: true });
});
