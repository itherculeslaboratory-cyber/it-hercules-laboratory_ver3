import { Hono } from "hono";

const app = new Hono();

// GET /health → { status: "ok" } — 契約正本: schemas/api/health.schema.json
app.get("/health", (c) => c.json({ status: "ok" }));

export default app;
