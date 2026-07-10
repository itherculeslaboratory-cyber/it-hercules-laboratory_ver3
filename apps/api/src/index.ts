import { Hono } from "hono";
import { TruthStore, type R2BucketLite } from "@ihl/truth";

type Bindings = {
  DEV_TOKEN: string;
  TRUTH: R2BucketLite;
};

const app = new Hono<{ Bindings: Bindings }>();

// CL-04 deny-by-default: ONLY these paths are public. Everything else —
// including unknown routes — hits the auth gate first (401 before 404).
const PUBLIC_ROUTES = ["/health"];

app.use("*", async (c, next) => {
  if (PUBLIC_ROUTES.includes(c.req.path)) return next();
  // C1 stand-in: a single DEV_TOKEN bearer (wrangler secret). Real sessions
  // (CL-03 session layer, opaque tokens → actor_id) land in C2.
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !c.env?.DEV_TOKEN || token !== c.env.DEV_TOKEN) {
    return c.json({ error: "AUTH_REQUIRED" }, 401);
  }
  await next();
});

// GET /health → { status: "ok" } — 契約正本: schemas/api/health.schema.json
app.get("/health", (c) => c.json({ status: "ok" }));

// POST /events — append an event envelope to Truth (R2, INSERT ONLY).
// 201 inserted / 400 invalid envelope / 409 duplicate key (first-wins,
// storage-enforced: docs/planning/c1/r2-put-if-absent-evidence.md).
app.post("/events", async (c) => {
  const body = await c.req.json().catch(() => null);
  const result = await new TruthStore(c.env.TRUTH).putEvent(body);
  if (result.status === "invalid") {
    return c.json({ error: "INVALID_ENVELOPE", details: result.errors }, 400);
  }
  if (result.status === "conflict") {
    return c.json({ error: "DUPLICATE_EVENT", key: result.key }, 409);
  }
  return c.json({ key: result.key }, 201);
});

export default app;
