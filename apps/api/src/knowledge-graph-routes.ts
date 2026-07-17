// V3-WIK-20 — 薄い route(判定は knowledge-graph.ts の純関数に委譲)。PROTECTED
// (index.ts §1.5 gate 経由・deny-by-default)。
import { Hono } from "hono";
import { TruthStore } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { projectKnowledgeCell } from "./knowledge-graph";

export const knowledgeGraphRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}

// GET /knowledge/cell/{id} — 意図(intent)・系譜(lineage)・被引用(referenced_by)を
// 1クエリで返す横断投影(WIK-20)。post_id/content_id/fork_id/culture template
// version_id/proposal_id のいずれとも一致しなければ 404。
knowledgeGraphRoutes.get("/knowledge/cell/:id", async (c) => {
  const cell = await projectKnowledgeCell(store(c), c.req.param("id"));
  if (!cell) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json(cell);
});
