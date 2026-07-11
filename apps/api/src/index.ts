import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { TruthStore, deriveActorId } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { verifySessionToken } from "./session";
import { authRoutes } from "./auth-routes";
import { obsRoutes } from "./observation-routes";
import { collectorRoutes } from "./collector-routes";
import { ledgerRoutes } from "./ledger-routes";
import { gmoRoutes } from "./gmo-routes";
import { marketRoutes } from "./market-routes";
import { piiRoutes } from "./pii-routes";

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
  // dev-only 1-click login (§1.4 V3-AUT-05). Self-gates on DEV_TOKEN: 404 in
  // prod where DEV_TOKEN is unset, so exposing the path adds no prod surface.
  "/api/v1/auth/dev-login",
  // collector ingest (design-c3 §3): public at the session layer, self-gated by
  // Ed25519 signature — the signature IS the credential (CL-09). Unsigned/forged
  // → 401 inside the route, so no session surface is exposed.
  "/api/v1/collector/ingest",
];

// Auth middleware (§1.5). Order: PUBLIC → Cookie → Bearer session → Bearer DEV_TOKEN → 401.
app.use("*", async (c, next) => {
  if (PUBLIC_ROUTES.includes(c.req.path)) return next();

  const secret = c.env?.SESSION_SECRET;

  // roles claim(V3-AUT-22)を安全に取り出す(非配列/非文字列要素は捨てる)。
  const rolesOf = (p: { roles?: unknown }): string[] =>
    Array.isArray(p.roles) ? p.roles.filter((x): x is string => typeof x === "string") : [];

  // ② HttpOnly Cookie ihl_session
  const cookieTok = getCookie(c, "ihl_session");
  if (cookieTok && secret) {
    const p = await verifySessionToken(cookieTok, secret);
    if (p) {
      c.set("actorId", p.sub);
      c.set("roles", rolesOf(p));
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
        c.set("roles", rolesOf(p));
        return next();
      }
    }
    if (c.env?.DEV_TOKEN && bearer === c.env.DEV_TOKEN) {
      c.set("actorId", await deriveActorId("dev@ihl.local"));
      c.set("roles", []); // DEV_TOKEN 経路はロール無し
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

// Collector ingest (§3 design-c3): POST /api/v1/collector/ingest. Ed25519
// signature-authenticated (public at session layer, self-gated by signature).
app.route("/api/v1", collectorRoutes);

// Economy ledger projection (design-c4 §1): GET /api/v1/me/ledger — 本人スコープ
// karma(value/count 二層)+ platinum の都度再計算投影 (V3-KRM-01/02 / CL-12).
app.route("/api/v1", ledgerRoutes);

// GMO sunabar 照合 (design-c4 §2 / CL-11): GET /gmo/transfer-code・
// POST /gmo/expected-payment・GET /gmo/reconciliation/meta。全て本人スコープ・保護。
// 照合ジョブ reconcileOnce はサーバ内関数(Cron 配線は C5)。
app.route("/api/v1", gmoRoutes);

// Market skeleton (design-c4 §3 / V3-MKT-01): POST /market/listings(出品)・
// GET /market/listings(一覧投影)・GET /market/listings/{id}(詳細)。全て保護。
// 取引遷移(match/transition)・決済連動は C4 対象外。
app.route("/api/v1", marketRoutes);

// PII セッション (design-c5 K2 §1.1 / V3-SEC-07 / route 045): POST /api/v1/settings/
// pii-session。保護・非永続(maskPii を返すのみ・Truth へ生 PII を append しない)。
app.route("/api/v1", piiRoutes);

// POST /events — append an event envelope to Truth (R2, INSERT ONLY).
// 201 inserted / 400 invalid envelope / 409 duplicate key (first-wins,
// storage-enforced: docs/planning/c1/r2-put-if-absent-evidence.md).
// V3-AUT-17 (本人スコープ): the STORED envelope's provenance.actor_id is
// force-stamped to the session principal — a client-forged provenance.actor_id
// is overwritten before persistence, never trusted. Response echoes the same.
app.post("/events", async (c) => {
  const body = await c.req.json().catch(() => null);
  const actorId = c.get("actorId");
  if (body && typeof body === "object" && typeof (body as { provenance?: unknown }).provenance === "object" && (body as { provenance?: unknown }).provenance) {
    (body as { provenance: Record<string, unknown> }).provenance.actor_id = actorId;
  }
  const result = await new TruthStore(c.env.TRUTH).putEvent(body);
  if (result.status === "invalid") {
    return c.json({ error: "INVALID_ENVELOPE", details: result.errors }, 400);
  }
  if (result.status === "conflict") {
    return c.json({ error: "DUPLICATE_EVENT", key: result.key }, 409);
  }
  return c.json({ key: result.key, actor_id: actorId }, 201);
});

export default app;
