// MKT-22 テンプレマーケット(論文/UIスキン/グラフ/重み/AIパック/プロンプト)。
// 出品/フォークは append-only ihl.mkt.template.v1、ランキングは RANKING_WEIGHTS
// (usage40/retention20/rating20/forks10/improvements10)で投影算出(常駐 DB 禁止・
// 不変条項①)。fork は forked_from で系譜連結。全 route PROTECTED・actor_id はセッション
// principal 強制(V3-AUT-17)。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { RANKING_WEIGHTS } from "./economy-constants";

const TEMPLATE_TYPE = "ihl.mkt.template.v1";
const TEMPLATE_SCHEMA = "schemas/events/mkt-template.schema.json";
const SCHEMA_VERSION = "1";
const KINDS = ["paper", "ui_skin", "graph", "weights", "ai_pack", "prompt"];

export const marketTemplateRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

/** ランキング指標(0..1 正規化想定)。forks は fork グラフから導出、他は指標ストリーム
 *  実装後に埋まる(現状 0・ponytail 参照)。重みは RANKING_WEIGHTS で凍結(MKT-22)。 */
export interface RankingMetrics {
  usage?: number;
  retention?: number;
  rating?: number;
  forks?: number;
  improvements?: number;
}

/** 40/20/20/10/10 の重み付き合計(MKT-22)。定数はテストで凍結スナップショット。 */
export function rankingScore(m: RankingMetrics): number {
  const w = RANKING_WEIGHTS;
  return (
    (m.usage ?? 0) * w.usage +
    (m.retention ?? 0) * w.retention +
    (m.rating ?? 0) * w.rating +
    (m.forks ?? 0) * w.forks +
    (m.improvements ?? 0) * w.improvements
  );
}

export interface RankedTemplate {
  template_id: string;
  actor_id: string;
  kind: string;
  title: string;
  forked_from?: string;
  fork_count: number;
  score: number;
}

/** テンプレ一覧を fork グラフから forks を導出しランキング降順に整列(MKT-22)。
 *  ponytail: usage/retention/rating/improvements は専用ストリーム未実装のため 0。
 *  そのストリームが着地したら metricsById を差し込む(重み式 rankingScore は据置)。 */
export function rankTemplates(templates: Record<string, unknown>[]): RankedTemplate[] {
  const forkCount = new Map<string, number>();
  for (const t of templates) {
    const parent = typeof t.forked_from === "string" ? t.forked_from : undefined;
    if (parent) forkCount.set(parent, (forkCount.get(parent) ?? 0) + 1);
  }
  return templates
    .map((t) => {
      const id = String(t.template_id);
      const forks = forkCount.get(id) ?? 0;
      return {
        template_id: id,
        actor_id: String(t.actor_id),
        kind: String(t.kind),
        title: String(t.title),
        forked_from: typeof t.forked_from === "string" ? t.forked_from : undefined,
        fork_count: forks,
        score: rankingScore({ forks }),
      };
    })
    .sort((a, b) => b.score - a.score || a.template_id.localeCompare(b.template_id));
}

function envelope(id: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: TEMPLATE_TYPE,
    time: new Date().toISOString(),
    dataschema: TEMPLATE_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}

async function appendTemplate(
  c: { env: Bindings },
  actorId: string,
  kind: string,
  title: string,
  forkedFrom: string | undefined,
  bodyRef: string | undefined,
) {
  const id = ulid();
  const data: Record<string, unknown> = {
    template_id: id,
    actor_id: actorId,
    kind,
    title,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (forkedFrom) data.forked_from = forkedFrom;
  if (bodyRef) data.body_ref = bodyRef;
  const res = await store(c).putEvent(envelope(id, actorId, data));
  return { res, id };
}

// POST /market/templates — 出品を append(kind/title 必須)。
marketTemplateRoutes.post("/market/templates", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const kind = body && typeof body.kind === "string" ? body.kind : "";
  const title = body && typeof body.title === "string" ? body.title.trim() : "";
  if (!KINDS.includes(kind) || !title) {
    return c.json({ error: "INVALID_TEMPLATE", details: ["kind (enum) and title required"] }, 400);
  }
  const bodyRef = typeof body?.body_ref === "string" ? body.body_ref : undefined;
  const { res, id } = await appendTemplate(c, c.get("actorId"), kind, title, undefined, bodyRef);
  if (res.status === "invalid") return c.json({ error: "INVALID_TEMPLATE", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_TEMPLATE", key: res.key }, 409);
  return c.json({ template_id: id }, 201);
});

// GET /market/templates — 一覧 + ランキング(RANKING_WEIGHTS・fork グラフ由来 forks)。
marketTemplateRoutes.get("/market/templates", async (c) => {
  const templates = (await store(c).listEvents(`truth/${TEMPLATE_TYPE}/`)).map(dataOf);
  return c.json({ templates: rankTemplates(templates) });
});

// POST /market/templates/{id}/fork — フォーク出品(forked_from=親で系譜連結・MKT-22)。
marketTemplateRoutes.post("/market/templates/:id/fork", async (c) => {
  const parentId = c.req.param("id");
  const parentEv = await store(c).readEvent(`truth/${TEMPLATE_TYPE}/${parentId}.json`);
  if (!parentEv) return c.json({ error: "NOT_FOUND" }, 404);
  const parent = dataOf(parentEv);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : `Fork of ${String(parent.title)}`;
  const bodyRef = typeof body.body_ref === "string" ? body.body_ref : undefined;
  const { res, id } = await appendTemplate(c, c.get("actorId"), String(parent.kind), title, parentId, bodyRef);
  if (res.status === "invalid") return c.json({ error: "INVALID_TEMPLATE", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_TEMPLATE", key: res.key }, 409);
  return c.json({ template_id: id, forked_from: parentId }, 201);
});
