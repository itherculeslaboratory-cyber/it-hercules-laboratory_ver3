// V3-MKT-06: 未出品個体への直接オファー(欲しい意思表示)を個体詳細画面から送信できる
// ようにする。既存の POST /market/offers は listing_id 必須(=既に出品された商品への
// オファー)で「未出品個体」には使えなかった — 本ファイルはそれとは別の薄い経路
// (ihl.mkt.individual_offer.v1)を個体(individual_id)へ直接ぶら下げる。オファーの
// 拒否設定(offer_policy)はその個体の現観測者(=個体マスタ ihl.ind.master.v1 の
// actor_id)が設定する(closed=完全拒否/research_only=研究目的申告のみ/open=既定)。
// 全 route PROTECTED・actor_id はセッション principal 強制(V3-AUT-17)。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { isBlockedPair } from "./market-block-routes";

// ihl.ind.master.v1 は individual-routes.ts の非 export 定数(あちらを改変せず型名だけ
// 参照する・命名は design-k1 の個体マスタ規約に固定)。
const MASTER_TYPE = "ihl.ind.master.v1";
const POLICY_TYPE = "ihl.mkt.offer_policy.v1";
const POLICY_SCHEMA = "schemas/events/mkt-offer-policy.schema.json";
const OFFER_TYPE = "ihl.mkt.individual_offer.v1";
const OFFER_SCHEMA = "schemas/events/mkt-individual-offer.schema.json";
const SCHEMA_VERSION = "1";
const POLICIES = new Set(["open", "closed", "research_only"]);

export const marketIndividualOfferRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

async function currentObserver(s: TruthStore, individualId: string): Promise<string | null> {
  const master = await s.readEvent(`truth/${MASTER_TYPE}/${individualId}.json`);
  if (!master) return null;
  const owner = dataOf(master).actor_id;
  return typeof owner === "string" ? owner : null;
}

// 個体ごとのオファーポリシー投影(pref-set.ts と同じ last-write-wins・都度再計算)。
// 未設定は基本テンプレ既定 'open'(V3-MKT-06「基本テンプレ自動付与+個別override」)。
export async function projectOfferPolicy(s: TruthStore, individualId: string): Promise<{ policy: string; note?: string }> {
  const events = (await s.listEvents(`truth/${POLICY_TYPE}/${individualId}/`))
    .map(dataOf)
    .sort((a, b) => {
      const ca = String(a.created_at ?? "");
      const cb = String(b.created_at ?? "");
      if (ca !== cb) return ca < cb ? -1 : 1;
      return String(a.policy_id ?? "") < String(b.policy_id ?? "") ? -1 : 1;
    });
  const last = events[events.length - 1];
  if (!last) return { policy: "open" };
  return { policy: String(last.policy), note: typeof last.note === "string" ? last.note : undefined };
}

function policyEnvelope(id: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: POLICY_TYPE,
    time: new Date().toISOString(),
    dataschema: POLICY_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}
function offerEnvelope(id: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: OFFER_TYPE,
    time: new Date().toISOString(),
    dataschema: OFFER_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}

// POST /individuals/{id}/offer-policy — 現観測者のみ設定可(拒否設定は現観測者が設定・
// V3-MKT-06/V3-MKT-29共通文言)。
marketIndividualOfferRoutes.post("/individuals/:individual_id/offer-policy", async (c) => {
  const individualId = c.req.param("individual_id");
  const s = store(c);
  const owner = await currentObserver(s, individualId);
  if (!owner) return c.json({ error: "NOT_FOUND" }, 404);
  const actorId = c.get("actorId");
  if (owner !== actorId) return c.json({ error: "FORBIDDEN", details: ["current observer only"] }, 403);

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const policy = typeof body?.policy === "string" ? body.policy : "";
  if (!POLICIES.has(policy)) {
    return c.json({ error: "INVALID_POLICY", details: ["policy must be open|closed|research_only"] }, 400);
  }
  const id = ulid();
  const data: Record<string, unknown> = {
    policy_id: id,
    individual_id: individualId,
    actor_id: actorId,
    policy,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (typeof body?.note === "string") data.note = body.note;
  const res = await s.putEventAt(`truth/${POLICY_TYPE}/${individualId}/${id}.json`, policyEnvelope(id, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_POLICY", details: res.errors }, 400);
  return c.json({ individual_id: individualId, policy }, 201);
});

// GET /individuals/{id}/offer-policy — 誰でも閲覧可(オファーを出す前に方針を確認できる)。
marketIndividualOfferRoutes.get("/individuals/:individual_id/offer-policy", async (c) => {
  const individualId = c.req.param("individual_id");
  return c.json({ individual_id: individualId, ...(await projectOfferPolicy(store(c), individualId)) });
});

// POST /individuals/{id}/offers — 未出品個体への直接オファー/告白方式(love_letter)。
// 拒否設定(closed)は 409、research_only は purpose="research" 以外を 409 で拒否。
marketIndividualOfferRoutes.post("/individuals/:individual_id/offers", async (c) => {
  const individualId = c.req.param("individual_id");
  const s = store(c);
  const owner = await currentObserver(s, individualId);
  if (!owner) return c.json({ error: "NOT_FOUND" }, 404);
  const actorId = c.get("actorId");
  if (owner === actorId) return c.json({ error: "FORBIDDEN", details: ["cannot offer on your own individual"] }, 403);
  if (await isBlockedPair(s, actorId, owner)) return c.json({ error: "BLOCKED" }, 403); // V3-MKT-61

  const { policy } = await projectOfferPolicy(s, individualId);
  if (policy === "closed") return c.json({ error: "OFFER_REJECTED", details: ["owner set policy=closed"] }, 409);

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const purpose = body?.purpose === "research" ? "research" : "personal";
  if (policy === "research_only" && purpose !== "research") {
    return c.json({ error: "OFFER_REJECTED", details: ["owner accepts research_only offers"] }, 409);
  }
  const kind = body?.love_letter === true ? "love_letter" : "offer";

  const id = ulid();
  const data: Record<string, unknown> = {
    offer_id: id,
    individual_id: individualId,
    actor_id: actorId,
    owner_id: owner,
    kind,
    purpose,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (kind === "offer" && Number.isFinite(Number(body?.amount))) data.amount = Number(body?.amount);
  if (typeof body?.message === "string") data.message = body.message;

  const res = await s.putEventAt(`truth/${OFFER_TYPE}/${individualId}/${id}.json`, offerEnvelope(id, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_OFFER", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_OFFER", key: res.key }, 409);
  return c.json({ offer_id: id, individual_id: individualId, kind }, 201);
});

// GET /individuals/{id}/offers — 現観測者のみ閲覧可(love_letter は値段非開示・
// POST /market/offers の board 集約と同じ規約)。
marketIndividualOfferRoutes.get("/individuals/:individual_id/offers", async (c) => {
  const individualId = c.req.param("individual_id");
  const s = store(c);
  const owner = await currentObserver(s, individualId);
  if (!owner) return c.json({ error: "NOT_FOUND" }, 404);
  const actorId = c.get("actorId");
  if (owner !== actorId) return c.json({ error: "FORBIDDEN", details: ["current observer only"] }, 403);

  const offers = (await s.listEvents(`truth/${OFFER_TYPE}/${individualId}/`)).map(dataOf).map((d) => ({
    offer_id: d.offer_id,
    from: d.actor_id,
    kind: d.kind,
    purpose: d.purpose,
    amount: d.kind === "love_letter" ? undefined : d.amount,
    message: d.message,
    at: d.created_at,
  }));
  return c.json({ individual_id: individualId, offers });
});
