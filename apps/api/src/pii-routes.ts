// PII セッション route(route 045・V3-SEC-07)。index.ts で app.route("/api/v1", …)
// にマウント → 最終パス /api/v1/settings/pii-session(route-matrix.csv infra-route-045)。
// protected(PUBLIC_ROUTES に入れない = deny-by-default)。
//
// 非永続: maskPii を呼び返すだけで Truth へは一切 append しない。生 PII をどこにも
// 保存しない = 「マスク前保存禁止」を構造的に充足(セッション限定の投影)。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { maskPii } from "./pii.mjs";

export const piiRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// POST /settings/pii-session — { text } → { masked, findings, count }。永続なし。
piiRoutes.post("/settings/pii-session", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { text?: unknown } | null;
  if (!body || typeof body.text !== "string") {
    return c.json({ error: "INVALID_TEXT" }, 400);
  }
  const { masked, findings } = maskPii(body.text);
  return c.json({ masked, findings, count: findings.length });
});

// ── V3-SEC-12 局留め連絡先エスクロー ─────────────────────────────────────
// 個人情報(フルネーム・配送先・銀行振込口座)を掲示板等の公開領域に直書きさせず、
// 取引ペア(本人+相手方のみ)に参照範囲を限定した非公開レコードとして事前登録する。
// data の形は schemas 未登録(C1スキーマ検証は envelope 外形のみ・best-effort
// スコープ=progress.jsonのscope注記どおり)。暗号化は行わない(zero-knowledge化は
// key-bundle-routes.ts の別機構であり本ルートの対象外・平文でTRUTHへ append)。
const ESCROW_TYPE = "ihl.sec.escrow_contact.v1";

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}

interface EscrowContactBody {
  counterparty_actor_id?: unknown;
  full_name?: unknown;
  address?: unknown;
  bank_account?: unknown;
}

// POST /trade/escrow-contact — 本人(actorId)が counterparty_actor_id との取引専用に
// 局留め連絡先を登録する。以後この2者(本人+相手方)のみが参照できる。
piiRoutes.post("/trade/escrow-contact", async (c) => {
  const body = (await c.req.json().catch(() => null)) as EscrowContactBody | null;
  if (
    !body ||
    typeof body.counterparty_actor_id !== "string" ||
    !body.counterparty_actor_id ||
    typeof body.full_name !== "string" ||
    !body.full_name
  ) {
    return c.json({ error: "INVALID_ESCROW_CONTACT", details: ["counterparty_actor_id and full_name (string) required"] }, 400);
  }
  const actorId = c.get("actorId");
  if (body.counterparty_actor_id === actorId) {
    return c.json({ error: "INVALID_COUNTERPARTY", details: ["counterparty_actor_id must differ from the caller"] }, 400);
  }
  const escrowId = ulid();
  const data: Record<string, unknown> = {
    escrow_id: escrowId,
    owner_actor_id: actorId,
    counterparty_actor_id: body.counterparty_actor_id,
    full_name: body.full_name,
    created_at: new Date().toISOString(),
  };
  if (typeof body.address === "string" && body.address) data.address = body.address;
  if (typeof body.bank_account === "string" && body.bank_account) data.bank_account = body.bank_account;
  const key = `truth/${ESCROW_TYPE}/${escrowId}.json`;
  const res = await store(c).putEventAt(key, {
    specversion: "1.0",
    id: escrowId,
    source: "apps/api",
    type: ESCROW_TYPE,
    time: new Date().toISOString(),
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  });
  if (res.status === "invalid") return c.json({ error: "INVALID_ESCROW_CONTACT", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_ESCROW_CONTACT", key: res.key }, 409);
  return c.json({ escrow_id: escrowId }, 201);
});

// GET /trade/escrow-contact/:escrowId — 本人 or 相手方のみ参照可(第三者は403)。
piiRoutes.get("/trade/escrow-contact/:escrowId", async (c) => {
  const escrowId = c.req.param("escrowId");
  const actorId = c.get("actorId");
  const key = `truth/${ESCROW_TYPE}/${escrowId}.json`;
  const stored = await store(c).readEvent(key);
  if (!stored) return c.json({ error: "NOT_FOUND" }, 404);
  const data = (stored.data ?? {}) as Record<string, unknown>;
  if (data.owner_actor_id !== actorId && data.counterparty_actor_id !== actorId) {
    return c.json({ error: "FORBIDDEN" }, 403);
  }
  return c.json({
    escrow_id: data.escrow_id,
    owner_actor_id: data.owner_actor_id,
    counterparty_actor_id: data.counterparty_actor_id,
    full_name: data.full_name,
    address: data.address ?? null,
    bank_account: data.bank_account ?? null,
    created_at: data.created_at,
  });
});
