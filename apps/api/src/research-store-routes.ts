// V3-MKT-45: 研究成果(project_id)に紐づく商品を出品し、外部EC(BASE/Shopify)誘導・
// プラチナコイン・代引き(現金)の3方式を統合した研究支援ストア。実鍵は無い(research-
// ec-adapter.ts が縮退・在庫同期の成否に関わらず注文は成立させる)。在庫は
// inventory_count(出品時の初期値・append-only)からの都度再計算(不変条項①③・UPDATE
// しない)。プラチナ決済は残高・在庫チェック後にのみ注文イベントを append する(=append
// 自体がコイン減算の正本。ihl.economy.coin_event.v1 に直接デビットは書かない=frozen
// 契約は付与のみのため、ここでも既存の「2ストリーム差引き」モデル(social-routes.ts
// projectCoinsSpent と同型)をストア注文にも適用する)。全 route PROTECTED・actor_id は
// セッション principal 強制(V3-AUT-17)。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { projectLedger } from "./ledger-routes";
import { projectCoinsSpent } from "./social-routes";
import { syncExternalStock } from "./research-ec-adapter";

const ITEM_TYPE = "ihl.mkt.store_item.v1";
const ITEM_SCHEMA = "schemas/events/mkt-store-item.schema.json";
export const ORDER_TYPE = "ihl.mkt.store_order.v1"; // export: V3-MKT-40 台帳検算バッチが再利用(debit 側の正本)
const ORDER_SCHEMA = "schemas/events/mkt-store-order.schema.json";
const SCHEMA_VERSION = "1";
const PAYMENT_METHODS = new Set(["platinum", "cod", "external_ec"]);

export const researchStoreRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

function itemEnvelope(id: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0", id, source: "apps/api", type: ITEM_TYPE, time: new Date().toISOString(),
    dataschema: ITEM_SCHEMA, provenance: { generator_kind: "human", actor_id: actorId }, data,
  };
}
function orderEnvelope(id: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0", id, source: "apps/api", type: ORDER_TYPE, time: new Date().toISOString(),
    dataschema: ORDER_SCHEMA, provenance: { generator_kind: "human", actor_id: actorId }, data,
  };
}

async function listOrders(s: TruthStore, itemId: string): Promise<Record<string, unknown>[]> {
  return (await s.listEvents(`truth/${ORDER_TYPE}/${itemId}/`)).map(dataOf);
}

/** 可用在庫 = inventory_count − Σ既存注文quantity(都度再計算・不変条項①③)。 */
export function availableInventory(item: { inventory_count: number }, orders: { quantity: number }[]): number {
  const consumed = orders.reduce((a, o) => a + (Number(o.quantity) || 0), 0);
  return item.inventory_count - consumed;
}

/** 本人がこのストアで既に使ったプラチナコイン累計(payment_method=platinum の注文の
 * unit_price_platinum*quantity 合計)。social-routes.ts の投票消費と同じ「差引き」モデルを
 * 別ストリームとして適用する(frozen coin_event は付与のみのため)。 */
export async function projectStoreCoinsSpent(s: TruthStore, actorId: string): Promise<number> {
  const orders = (await s.listEvents(`truth/${ORDER_TYPE}/`)).map(dataOf);
  return orders
    .filter((o) => o.actor_id === actorId && o.payment_method === "platinum")
    .reduce((a, o) => a + (Number(o.unit_price_platinum) || 0) * (Number(o.quantity) || 0), 0);
}

// POST /research/store/items — 出品(project_id 紐づけ・決済方式の許可リスト)。
researchStoreRoutes.post("/research/store/items", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const projectId = typeof body?.project_id === "string" ? body.project_id : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const inventory = Number(body?.inventory_count);
  const methods = Array.isArray(body?.payment_methods)
    ? (body.payment_methods as unknown[]).filter((m): m is string => typeof m === "string" && PAYMENT_METHODS.has(m))
    : [];
  if (!projectId || !title || !Number.isInteger(inventory) || inventory < 0 || methods.length === 0) {
    return c.json(
      { error: "INVALID_ITEM", details: ["project_id, title, inventory_count>=0, payment_methods(>=1) required"] },
      400,
    );
  }
  if (methods.includes("platinum") && !(Number.isInteger(Number(body?.price_platinum)) && Number(body?.price_platinum) >= 0)) {
    return c.json({ error: "INVALID_ITEM", details: ["price_platinum required when payment_methods includes platinum"] }, 400);
  }

  const actorId = c.get("actorId");
  const id = ulid();
  const data: Record<string, unknown> = {
    item_id: id,
    project_id: projectId,
    actor_id: actorId,
    title,
    inventory_count: inventory,
    payment_methods: methods,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (methods.includes("platinum")) data.price_platinum = Number(body?.price_platinum);
  if (methods.includes("external_ec") && typeof body?.external_ec_url === "string") data.external_ec_url = body.external_ec_url;

  const res = await store(c).putEventAt(`truth/${ITEM_TYPE}/${id}.json`, itemEnvelope(id, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_ITEM", details: res.errors }, 400);
  return c.json({ item_id: id }, 201);
});

// GET /research/store/items?project_id= — 一覧(可用在庫を都度算出)。
researchStoreRoutes.get("/research/store/items", async (c) => {
  const s = store(c);
  const projectId = c.req.query("project_id") || undefined;
  const items = (await s.listEvents(`truth/${ITEM_TYPE}/`)).map(dataOf).filter((it) => !projectId || it.project_id === projectId);
  const out = [];
  for (const it of items) {
    const orders = await listOrders(s, String(it.item_id));
    out.push({ ...it, available: availableInventory({ inventory_count: Number(it.inventory_count) }, orders as { quantity: number }[]) });
  }
  return c.json({ items: out });
});

// POST /research/store/items/{id}/orders — 注文(在庫チェック必須・決済成功時に自動減算=
// append自体が減算の正本)。platinum は残高・在庫チェック後にのみ append。
researchStoreRoutes.post("/research/store/items/:item_id/orders", async (c) => {
  const itemId = c.req.param("item_id");
  const s = store(c);
  const itemEv = await s.readEvent(`truth/${ITEM_TYPE}/${itemId}.json`);
  if (!itemEv) return c.json({ error: "NOT_FOUND" }, 404);
  const item = dataOf(itemEv);

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const method = typeof body?.payment_method === "string" ? body.payment_method : "";
  const quantity = Number(body?.quantity);
  if (!PAYMENT_METHODS.has(method) || !Number.isInteger(quantity) || quantity < 1) {
    return c.json({ error: "INVALID_ORDER", details: ["payment_method + quantity>=1 required"] }, 400);
  }
  if (!(item.payment_methods as string[] | undefined)?.includes(method)) {
    return c.json({ error: "PAYMENT_METHOD_NOT_ALLOWED" }, 400);
  }

  const orders = await listOrders(s, itemId);
  const available = availableInventory({ inventory_count: Number(item.inventory_count) }, orders as { quantity: number }[]);
  if (available < quantity) return c.json({ error: "OUT_OF_STOCK", available }, 409); // 在庫チェック必須

  const actorId = c.get("actorId");
  const data: Record<string, unknown> = {
    order_id: ulid(),
    item_id: itemId,
    actor_id: actorId,
    payment_method: method,
    quantity,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };

  if (method === "platinum") {
    const unitPrice = Number(item.price_platinum) || 0;
    const cost = unitPrice * quantity;
    const { platinum_coins } = await projectLedger(s, actorId);
    const spent = (await projectCoinsSpent(s, actorId)) + (await projectStoreCoinsSpent(s, actorId));
    const balance = platinum_coins - spent;
    if (balance < cost) return c.json({ error: "INSUFFICIENT_COINS", balance, requested: cost }, 402); // 残高チェック後にのみコイン減算
    data.unit_price_platinum = unitPrice;
  }

  const id = data.order_id as string;
  const res = await s.putEventAt(`truth/${ORDER_TYPE}/${itemId}/${id}.json`, orderEnvelope(id, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_ORDER", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_ORDER", key: res.key }, 409);

  // 外部EC在庫同期は縮退(実鍵無し=呼ばれず not-synced)。注文成立の必須条件にしない。
  const sync = method === "external_ec" ? await syncExternalStock(c.env, { item_id: itemId, external_ec_url: item.external_ec_url as string | undefined }) : undefined;

  return c.json({ order_id: id, item_id: itemId, payment_method: method, external_ec_sync: sync }, 201);
});
