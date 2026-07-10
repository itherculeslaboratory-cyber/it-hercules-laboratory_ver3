import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { TruthStore, deriveActorId } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { verifySessionToken } from "./session";
import { authRoutes } from "./auth-routes";
import { obsRoutes } from "./observation-routes";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// CL-04 deny-by-default: ONLY these paths are public. Everything else —
// including unknown routes — hits the auth gate first (401 before 404).
// Public = /health + the 3 auth entry routes (magic-link/verify/session).
// logout is PROTECTED (§1.3): you must hold a session to end it.
const PUBLIC_ROUTES = [
  "/health",
  "/api/v1/auth/magic-link",
  "/api/v1/auth/verify",
  "/api/v1/auth/session",
];

// Auth middleware (§1.5). Order: PUBLIC → Cookie → Bearer session → Bearer DEV_TOKEN → 401.
app.use("*", async (c, next) => {
  if (PUBLIC_ROUTES.includes(c.req.path)) return next();

  const secret = c.env?.SESSION_SECRET;

  // ② HttpOnly Cookie ihl_session
  const cookieTok = getCookie(c, "ihl_session");
  if (cookieTok && secret) {
    const p = await verifySessionToken(cookieTok, secret);
    if (p) {
      c.set("actorId", p.sub);
      return next();
    }
  }

  // ③④ Authorization: Bearer <session token | DEV_TOKEN>
  const header = c.req.header("Authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (bearer) {
    if (bearer.startsWith("v1.") && secret) {
      const p = await verifySessionToken(bearer, secret);
      if (p) {
        c.set("actorId", p.sub);
        return next();
      }
    }
    if (c.env?.DEV_TOKEN && bearer === c.env.DEV_TOKEN) {
      c.set("actorId", await deriveActorId("dev@ihl.local"));
      return next();
    }
  }

  return c.json({ error: "AUTH_REQUIRED" }, 401);
});

// GET /health → { status: "ok" } — 契約正本: schemas/api/health.schema.json
app.get("/health", (c) => c.json({ status: "ok" }));

// Auth routes (§1.3): magic-link / verify / session / logout.
app.route("/api/v1/auth", authRoutes);

// Observation core (§3.2): captures / upload / detail / image / templates /
// individuals observations + qr / qr resolve. All protected (not in PUBLIC_ROUTES).
app.route("/api/v1", obsRoutes);

// POST /events — append an event envelope to Truth (R2, INSERT ONLY).
// 201 inserted / 400 invalid envelope / 409 duplicate key (first-wins,
// storage-enforced: docs/planning/c1/r2-put-if-absent-evidence.md).
// V3-AUT-17: response echoes the authenticated actor_id (session principal),
// so writes are attributable to the session, not client-forged identity.
app.post("/events", async (c) => {
  const body = await c.req.json().catch(() => null);
  const result = await new TruthStore(c.env.TRUTH).putEvent(body);
  if (result.status === "invalid") {
    return c.json({ error: "INVALID_ENVELOPE", details: result.errors }, 400);
  }
  if (result.status === "conflict") {
    return c.json({ error: "DUPLICATE_EVENT", key: result.key }, 409);
  }
  return c.json({ key: result.key, actor_id: c.get("actorId") }, 201);
});

export default app;
