// V3-WIK-32: テンプレート(スケール紙・QRラベル・研究ノート・生体カード・UIテンプレ・台本・
// AI設定パック)のFork公開編集(進化対象)/個人コピー(非公開)。forked_from で系譜を可視化し
// (個体マーケットの fork/forked_from とは別概念=テンプレ専用イベント型)、UI Schema の
// バージョン履歴を append-only で保存する。既存 plaza-routes.ts の FORK_TYPE(BBS-29・
// board/post 用)とは対象が異なるため型を分けた(用途混在を避ける・reuse だが同一型の
// 使い回しはしない=責務分離)。全 route PROTECTED(index.ts の auth middleware が actorId を set)。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { WIK_TEMPLATE_KINDS, WIK_TEMPLATE_OPERATIONS } from "./plaza-constants";

const TEMPLATE_TYPE = "ihl.wiki.template.v1";
const TEMPLATE_SCHEMA = "schemas/events/wiki-template.schema.json";
const SCHEMA_VERSION = "1";

export const plazaTemplateRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
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

export interface TemplateRecord {
  template_id: string;
  actor_id: string;
  kind: string;
  title: string;
  ui_schema: unknown;
  operation: "root" | "fork" | "copy";
  forked_from?: string;
  visibility: "public" | "private";
  created_at: string;
}

async function listTemplates(s: TruthStore): Promise<TemplateRecord[]> {
  return (await s.listEvents(`truth/${TEMPLATE_TYPE}/`)).map(dataOf) as unknown as TemplateRecord[];
}

async function createTemplateRecord(
  s: TruthStore,
  actorId: string,
  data: Omit<TemplateRecord, "template_id" | "actor_id" | "created_at">,
): Promise<TemplateRecord> {
  const templateId = ulid();
  const record: TemplateRecord = {
    template_id: templateId,
    actor_id: actorId,
    created_at: new Date().toISOString(),
    ...data,
  };
  const key = `truth/${TEMPLATE_TYPE}/${templateId}.json`;
  const res = await s.putEventAt(key, envelope(templateId, actorId, { ...record, schema_version: SCHEMA_VERSION }));
  if (res.status !== "inserted") throw Object.assign(new Error(res.status), { res });
  return record;
}

// POST /plaza/templates — 新規テンプレート作成(root)。
plazaTemplateRoutes.post("/plaza/templates", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const kind = str(body?.kind);
  const title = str(body?.title);
  if (!(WIK_TEMPLATE_KINDS as readonly string[]).includes(kind)) {
    return c.json({ error: "INVALID_TEMPLATE", details: [`kind must be one of ${WIK_TEMPLATE_KINDS.join(",")}`] }, 400);
  }
  if (!title.trim()) return c.json({ error: "INVALID_TEMPLATE", details: ["title required"] }, 400);

  const actorId = c.get("actorId");
  try {
    const record = await createTemplateRecord(store(c), actorId, {
      kind,
      title,
      ui_schema: body?.ui_schema ?? {},
      operation: "root",
      visibility: body?.visibility === "private" ? "private" : "public",
    });
    return c.json(record, 201);
  } catch (e) {
    return c.json({ error: "INVALID_TEMPLATE", details: [(e as Error).message] }, 400);
  }
});

// POST /plaza/templates/:template_id/fork — 公開編集(進化対象)。forked_from=元テンプレ。
// visibility は常に public(fork=文化はユーザーが作るの共有側)。
plazaTemplateRoutes.post("/plaza/templates/:template_id/fork", async (c) => {
  const templateId = c.req.param("template_id");
  const s = store(c);
  const source = (await listTemplates(s)).find((t) => t.template_id === templateId);
  if (!source) return c.json({ error: "NOT_FOUND" }, 404);

  const actorId = c.get("actorId");
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const record = await createTemplateRecord(s, actorId, {
    kind: source.kind,
    title: str(body?.title) || `${source.title} (fork)`,
    ui_schema: body?.ui_schema ?? source.ui_schema,
    operation: "fork",
    forked_from: templateId,
    visibility: "public",
  });
  return c.json(record, 201);
});

// POST /plaza/templates/:template_id/copy — 個人コピー(非公開・系譜には残らない=
// forked_from は記録するが「進化対象」ではないため lineage 探索の対象外にする設計は
// GET lineage 側で operation!=="fork" を除外することで表現する)。
plazaTemplateRoutes.post("/plaza/templates/:template_id/copy", async (c) => {
  const templateId = c.req.param("template_id");
  const s = store(c);
  const source = (await listTemplates(s)).find((t) => t.template_id === templateId);
  if (!source) return c.json({ error: "NOT_FOUND" }, 404);

  const actorId = c.get("actorId");
  const record = await createTemplateRecord(s, actorId, {
    kind: source.kind,
    title: `${source.title} (copy)`,
    ui_schema: source.ui_schema,
    operation: "copy",
    forked_from: templateId,
    visibility: "private",
  });
  return c.json(record, 201);
});

export interface TemplateLineage {
  template_id: string;
  chain: TemplateRecord[]; // root -> ... -> template_id(fork のみ辿る。copy は系譜に含めない)
}

// projectTemplateLineage — forked_from を遡って fork チェーンを再構成(都度再計算)。
export async function projectTemplateLineage(s: TruthStore, templateId: string): Promise<TemplateLineage | null> {
  const all = await listTemplates(s);
  const byId = new Map(all.map((t) => [t.template_id, t]));
  const start = byId.get(templateId);
  if (!start) return null;
  const chain: TemplateRecord[] = [start];
  let cur = start;
  while (cur.operation === "fork" && cur.forked_from) {
    const parent = byId.get(cur.forked_from);
    if (!parent) break;
    chain.unshift(parent);
    cur = parent;
  }
  return { template_id: templateId, chain };
}

// GET /plaza/templates/:template_id/lineage — fork 系譜可視化(公開)。
plazaTemplateRoutes.get("/plaza/templates/:template_id/lineage", async (c) => {
  const lineage = await projectTemplateLineage(store(c), c.req.param("template_id"));
  if (!lineage) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json(lineage);
});

// GET /plaza/templates?kind=<optional> — 一覧(private は除外・個人コピーは所有者のみ
// GET /plaza/templates/:id で直接見える設計。tags/検索は WIK-32 の主題ではないため対象外)。
plazaTemplateRoutes.get("/plaza/templates", async (c) => {
  const kind = c.req.query("kind") || undefined;
  const all = (await listTemplates(store(c))).filter((t) => t.visibility === "public");
  return c.json({ templates: kind ? all.filter((t) => t.kind === kind) : all, operations: WIK_TEMPLATE_OPERATIONS });
});
