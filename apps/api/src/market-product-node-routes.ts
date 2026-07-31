// V3-MKT-44(design19 §T1-7案A)。飼育用品を ProductNode として登録し、成功率/失敗率は
// 保存せず投影(その場計算)で導出する。材料は obs-capture(product_ref)と ind-life-event
// (死亡/生存訂正)。アフィリエイト実リンクは投入しない(人間ゲート・affiliate_url は
// 未設定のまま出荷可・空の時はリンクを出さない=壊れたリンクを出すより良い)。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";

const PRODUCT_TYPE = "ihl.mkt.product_node.v1";
const PRODUCT_SCHEMA = "schemas/events/mkt-product-node.schema.json";
const SCHEMA_VERSION = "1";
const OBS_CAPTURE_TYPE = "ihl.obs.capture.v1";
const LIFE_TYPE = "ihl.ind.life_event.v1";
const AFFILIATE_MODES = ["operator", "self"];

export const marketProductNodeRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}
function envelope(id: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: PRODUCT_TYPE,
    time: new Date().toISOString(),
    dataschema: PRODUCT_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}

// individual-routes.ts の deriveLifeStatus(死亡/生存訂正の終端判定・at昇順末尾勝ち)と
// 同型のロジックをここでも純関数として持つ(この投影は個体一覧側の関数を import すると
// glob越境になるため小さく再実装・ロジック自体は既存パターンの踏襲=二重発明ではない)。
function isDeadByLastTerminal(lifeEvents: Record<string, unknown>[]): boolean {
  const terminals = lifeEvents.filter((d) => d.kind === "death" || d.kind === "survival_correction");
  const last = terminals.slice().sort((a, b) => String(a.at).localeCompare(String(b.at))).pop();
  return last?.kind === "death";
}

/** V3-MKT-44: obs-capture(product_ref=productId)から紐づく individual_id 群を集め、
 * 各個体の最新終端life-eventで生死判定し、成功率(生存)/失敗率(死亡)を算出する純関数。
 * 保存せず都度投影(常駐DB禁止)。個体紐付けが0件なら null(未計測=表示側の責務)。 */
export async function projectProductSuccessRate(
  s: TruthStore,
  productId: string,
): Promise<{ n: number; success_rate: number; failure_rate: number } | null> {
  const captures = (await s.listEvents(`truth/${OBS_CAPTURE_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.product_ref === productId);
  const individualIds = new Set<string>();
  for (const cap of captures) {
    const ref = typeof cap.subject_ref === "string" ? cap.subject_ref : "";
    if (ref.startsWith("individual/")) individualIds.add(ref.slice("individual/".length));
  }
  if (individualIds.size === 0) return null;

  let dead = 0;
  for (const individualId of individualIds) {
    const life = (await s.listEvents(`truth/${LIFE_TYPE}/${individualId}-`)).map(dataOf);
    if (isDeadByLastTerminal(life)) dead++;
  }
  const n = individualIds.size;
  return { n, success_rate: (n - dead) / n, failure_rate: dead / n };
}

// POST /market/products — ProductNode登録(name/category/affiliate_mode必須)。
// affiliate_mode=self の場合のみ affiliate_url を受け付ける(operatorの実運営URLは
// このラウンドでは未配線=人間ゲート・要件どおり空のまま出荷)。
marketProductNodeRoutes.post("/market/products", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const name = body && typeof body.name === "string" ? body.name.trim() : "";
  const category = body && typeof body.category === "string" ? body.category.trim() : "";
  const affiliateMode = body && typeof body.affiliate_mode === "string" ? body.affiliate_mode : "operator";
  if (!name || !category || !AFFILIATE_MODES.includes(affiliateMode)) {
    return c.json({ error: "INVALID_PRODUCT", details: ["name, category, affiliate_mode(operator|self) required"] }, 400);
  }
  const actorId = c.get("actorId");
  const id = ulid();
  const data: Record<string, unknown> = {
    product_id: id,
    name,
    category,
    affiliate_mode: affiliateMode,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (affiliateMode === "self" && typeof body?.affiliate_url === "string" && body.affiliate_url.trim()) {
    data.affiliate_url = body.affiliate_url.trim();
  }
  if (Array.isArray(body?.paper_refs)) data.paper_refs = body?.paper_refs;
  const res = await store(c).putEvent(envelope(id, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_PRODUCT", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_PRODUCT", key: res.key }, 409);
  return c.json({ product_id: id }, 201);
});

// GET /market/products — 一覧(affiliate_url未設定=空のときはリンクを出さない=フィールド省略のまま)。
marketProductNodeRoutes.get("/market/products", async (c) => {
  const products = (await store(c).listEvents(`truth/${PRODUCT_TYPE}/`)).map(dataOf);
  return c.json({ products });
});

// GET /market/products/{id} — 詳細 + 成功率/失敗率投影(obs-capture×ind-life-event)。
marketProductNodeRoutes.get("/market/products/:id", async (c) => {
  const id = c.req.param("id");
  const s = store(c);
  const ev = await s.readEvent(`truth/${PRODUCT_TYPE}/${id}.json`);
  if (!ev) return c.json({ error: "NOT_FOUND" }, 404);
  const stats = await projectProductSuccessRate(s, id);
  return c.json({ product: dataOf(ev), stats });
});
