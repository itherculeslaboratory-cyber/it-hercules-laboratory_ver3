// C5 K5 Canonical mapping / Category（design-k5 §2.1/§2.2 / V3-PPR-13）。Wikidata Q番号 ↔ 分野別
// 専門 DB の対応を append-only 記録（mapping_event）+ ユーザー追加可能な学術分類階層（category）。
// 外部専門 API の実クエリは §6 人間ゲート（不変条項①）— ここは DOMAIN_API_MAP オフライン対応表を
// 読むだけ（target_db が分野の許可先か検証）。全 route は index.ts §1.5 gate 経由 PROTECTED
// （deny-by-default: PUBLIC_ROUTES に載せない）。書込 actor_id はセッション principal 強制（V3-AUT-17）。
// 投影（getMapping / categoryTree）は都度再計算＝prefix scan（常駐 DB 禁止・不変条項①）。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { DOMAIN_API_MAP } from "./research-constants";

export const researchCanonicalRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const MAPPING_TYPE = "ihl.research.mapping_event.v1";
const MAPPING_SCHEMA = "schemas/events/mapping-event.schema.json";
const CATEGORY_TYPE = "ihl.research.category.v1";
const CATEGORY_SCHEMA = "schemas/events/category.schema.json";
const SCHEMA_VERSION = "1";

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}
function envelope(type: string, schema: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id: ulid(), // §2.2: envelope.id は毎回 ULID。決定論キー(qid__target_db / category_id)は storage key 側のみ。
    source: "apps/api",
    type,
    time: new Date().toISOString(),
    dataschema: schema,
    provenance: { generator_kind: "human", actor_id: actorId }, // V3-AUT-17 session principal 強制。
    data,
  };
}

// ── POST /research/canonical/mapping — Q番号↔専門DB 対応の append-only 記録（PPR-13）───────
// storage key = truth/<type>/<qid>__<target_db>.json → 同一対応の再 put=409（put-if-absent）。
// DOMAIN_API_MAP を読み、target_db がその domain の許可対応先でなければ 400（オフライン表参照のみ）。
researchCanonicalRoutes.post("/research/canonical/mapping", async (c) => {
  const actorId = c.get("actorId");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const wikidata_qid = typeof body.wikidata_qid === "string" ? body.wikidata_qid.trim() : "";
  const target_db = typeof body.target_db === "string" ? body.target_db.trim() : "";
  const target_id = typeof body.target_id === "string" ? body.target_id.trim() : "";
  const domain = typeof body.domain === "string" ? body.domain.trim() : "";
  if (!wikidata_qid || !target_db || !target_id || !domain) {
    return c.json({ error: "INVALID_MAPPING", details: ["wikidata_qid, target_db, target_id, domain required"] }, 400);
  }
  const allowed = DOMAIN_API_MAP[domain];
  if (!allowed || !allowed.includes(target_db)) {
    return c.json(
      { error: "INVALID_MAPPING", details: [`target_db ${target_db} not in DOMAIN_API_MAP[${domain}]`] },
      400,
    );
  }
  const mapping_id = `${wikidata_qid}__${target_db}`;
  const key = `truth/${MAPPING_TYPE}/${mapping_id}.json`;
  const data = {
    mapping_id,
    wikidata_qid,
    target_db,
    target_id,
    domain,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  const res = await store(c).putEventAt(key, envelope(MAPPING_TYPE, MAPPING_SCHEMA, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_MAPPING", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_MAPPING", key: res.key }, 409);
  return c.json({ mapping_id, key: res.key }, 201);
});

// ── 世界接続層 第3要素「使用時発行の内部Index」（PPR-13）────────────────────────────────
// Wikidata の全QID空間を先回りして採番せず（不変条項①「ID/Index は使う瞬間だけ発行」）、
// 新しい Truth 型・常駐カウンタも持たない: そのQIDが実際に「使われた」最初の瞬間 = 最初の
// mapping_event それ自体を、都度再計算（prefix scan）で内部Indexとして投影する（派生値は
// 都度再計算・不変条項①）。1件もmappingが無いQIDは「まだ使われていない」= null。
export interface CanonicalInternalIndex { mapping_id: string; issued_at: string }

export function internalIndex(
  mappings: Array<{ mapping_id: string; created_at: string }>,
): CanonicalInternalIndex | null {
  if (mappings.length === 0) return null;
  const [first] = [...mappings].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.mapping_id.localeCompare(b.mapping_id),
  );
  return { mapping_id: first.mapping_id, issued_at: first.created_at };
}

// ── GET /research/canonical/mapping/:qid — その Q番号の全対応先 + 内部Index を投影（PPR-13）
researchCanonicalRoutes.get("/research/canonical/mapping/:qid", async (c) => {
  const qid = c.req.param("qid");
  const items = (await store(c).listEvents(`truth/${MAPPING_TYPE}/${qid}__`))
    .map(dataOf)
    .filter((d) => d.wikidata_qid === qid)
    .sort((a, b) => String(a.target_db).localeCompare(String(b.target_db)));
  const idx = internalIndex(items.map((d) => ({ mapping_id: String(d.mapping_id), created_at: String(d.created_at) })));
  return c.json({ wikidata_qid: qid, mappings: items, internal_index: idx });
});

// ── POST /research/categories — 学術分類の append-only 追加（PPR-13）──────────────────────
// domain 必須（亜種・重複防止）。parent_category_id で木構成。同一 category_id 再 put=409。
researchCanonicalRoutes.post("/research/categories", async (c) => {
  const actorId = c.get("actorId");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const domain = typeof body.domain === "string" ? body.domain.trim() : "";
  if (!label || !domain) {
    return c.json({ error: "INVALID_CATEGORY", details: ["label, domain required"] }, 400);
  }
  const category_id = typeof body.category_id === "string" && body.category_id ? body.category_id : ulid();
  const data: Record<string, unknown> = {
    category_id,
    actor_id: actorId, // V3-AUT-17 強制刻印（クライアント指定は無視）
    label,
    domain,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (typeof body.parent_category_id === "string" && body.parent_category_id) {
    data.parent_category_id = body.parent_category_id;
  }
  const key = `truth/${CATEGORY_TYPE}/${category_id}.json`;
  const res = await store(c).putEventAt(key, envelope(CATEGORY_TYPE, CATEGORY_SCHEMA, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_CATEGORY", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_CATEGORY", key: res.key }, 409);
  return c.json({ category_id, key: res.key }, 201);
});

// ── GET /research/categories — 親子木の投影（PPR-13・都度再計算）────────────────────────────
// prefix scan → parent_category_id で子をぶら下げる。roots = 親を持たない（or 親が不在の）分類。
// ?domain= で分野フィルタ。決定論: category_id 昇順。
export interface CategoryNode {
  category_id: string;
  label: string;
  domain: string;
  parent_category_id?: string;
  children: CategoryNode[];
}

export async function categoryTree(s: TruthStore, domain?: string): Promise<CategoryNode[]> {
  const rows = (await s.listEvents(`truth/${CATEGORY_TYPE}/`))
    .map(dataOf)
    .filter((d) => !domain || d.domain === domain)
    .sort((a, b) => String(a.category_id).localeCompare(String(b.category_id)));
  const nodes = new Map<string, CategoryNode>();
  for (const d of rows) {
    nodes.set(String(d.category_id), {
      category_id: String(d.category_id),
      label: String(d.label ?? ""),
      domain: String(d.domain ?? ""),
      ...(typeof d.parent_category_id === "string" ? { parent_category_id: d.parent_category_id } : {}),
      children: [],
    });
  }
  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent_category_id ? nodes.get(node.parent_category_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node); // 親不在（ルート or 親が別 domain フィルタ外）は root 扱い
  }
  return roots;
}

researchCanonicalRoutes.get("/research/categories", async (c) => {
  const domain = c.req.query("domain") ?? undefined;
  return c.json({ tree: await categoryTree(store(c), domain) });
});
