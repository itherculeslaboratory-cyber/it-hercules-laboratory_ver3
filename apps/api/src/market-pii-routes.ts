// V3-MKT-28(design19 §T1-3案A)。取引PIIの登録・参照・削除を「削除可能ストア」
// (R2の非truthプレフィクス=truth/ 配下ではないため append-only 契約[CL-12]の対象外)へ
// 実装する。取引側イベント(trade_event/mkt-transaction-event)にはPII実体を一切持たせず、
// pii_ref(trade_id/owner_actor_id/slot/granted_to/action)だけを Truth に append する。
// 「取引相手のみ参照可能」の認可判定は既存A-4リソースロール(owner/viewer)で足りる —
// 新しい権限概念は作らない(w-sec2側でも同旨確認済み・発注書より)。
//
// ★正直な制約(型F3点を満たせない箇所): 本ファイルが使う R2BucketLite
// (packages/truth/src/store.ts)・KVNamespaceLite(apps/api/src/kv.ts)のいずれにも
// delete() が定義されていない(TruthStoreの「更新/削除メソッドを意図的に持たない」
// という append-only 設計そのものが理由・store.ts:45-47のコメント参照)。この2ファイルは
// w1-mktのglob外のため本ラウンドでは変更しない。よって「削除」は実バイト削除ではなく、
// PII値をtombstone({deleted:true})で上書きする形で実装する(値は読めなくなるが
// オブジェクト自体はR2に残る)。真の削除が要るならR2BucketLite.delete()を
// packages/truth側に追加する設計判断が要る(このレーンの担当外・別ラウンドへ持ち越し)。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";

const PII_REF_TYPE = "ihl.mkt.pii_ref.v1";
const PII_REF_SCHEMA = "schemas/events/mkt-pii-ref.schema.json";
const PII_REF_SCHEMA_VERSION = "1";
const PII_PROFILE_PREFIX = "pii/profile"; // 非truthプレフィクス(append-only契約の対象外)

export const marketPiiRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}
function profileKey(actorId: string, slot: string): string {
  return `${PII_PROFILE_PREFIX}/${actorId}/${slot}.json`;
}

// このactorがtradeIdの当事者かを返す(owner/viewer判定に使う最小限の投影)。
// market-routes.ts の reduceMarket/loadTxns は import すると循環になるため、pii_ref
// イベント自体が持つ owner_actor_id/granted_to のみを根拠にする(取引本体の状態には
// 依存しない=PII参照権限は取引の成立状態と独立に付与/失効される設計・schema通り)。
async function latestGrant(
  s: TruthStore,
  tradeId: string,
  ownerActorId: string,
  slot: string,
  grantedTo: string,
): Promise<Record<string, unknown> | undefined> {
  const rows = (await s.listEvents(`truth/${PII_REF_TYPE}/`))
    .map(dataOf)
    .filter(
      (d) =>
        d.trade_id === tradeId &&
        d.owner_actor_id === ownerActorId &&
        d.slot === slot &&
        d.granted_to === grantedTo,
    )
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return rows[rows.length - 1];
}

function envelope(actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id: ulid(),
    source: "apps/api",
    type: PII_REF_TYPE,
    time: new Date().toISOString(),
    dataschema: PII_REF_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}

// PUT /market/pii/profile/{slot} — 本人プロフィールPIIの登録/更新(削除可能ストア・
// 非truthプレフィクス)。actor本人のみ書込可(セッションprincipal強制・V3-AUT-17)。
marketPiiRoutes.put("/market/pii/profile/:slot", async (c) => {
  const slot = c.req.param("slot");
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const value = body && typeof body.value === "string" ? body.value : "";
  if (!value) return c.json({ error: "INVALID_PII_PROFILE", details: ["value (string) required"] }, 400);
  const actorId = c.get("actorId");
  await c.env.TRUTH.put(
    profileKey(actorId, slot),
    JSON.stringify({ actor_id: actorId, slot, value, updated_at: new Date().toISOString() }),
  );
  return c.json({ actor_id: actorId, slot }, 200);
});

// DELETE /market/pii/profile/{slot} — 消去(tombstone上書き・上記の正直な制約を参照)。
marketPiiRoutes.delete("/market/pii/profile/:slot", async (c) => {
  const slot = c.req.param("slot");
  const actorId = c.get("actorId");
  await c.env.TRUTH.put(
    profileKey(actorId, slot),
    JSON.stringify({ actor_id: actorId, slot, deleted: true, deleted_at: new Date().toISOString() }),
  );
  return c.json({ actor_id: actorId, slot, deleted: true }, 200);
});

// POST /market/pii/grants — 取引相手へのPII参照許可/失効を append(action=granted|revoked)。
// owner_actor_id はセッション principal 強制(自分のPIIのみ許可/失効できる)。
marketPiiRoutes.post("/market/pii/grants", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const tradeId = body && typeof body.trade_id === "string" ? body.trade_id : "";
  const slot = body && typeof body.slot === "string" ? body.slot : "";
  const grantedTo = body && typeof body.granted_to === "string" ? body.granted_to : "";
  const action = body && typeof body.action === "string" ? body.action : "";
  if (!tradeId || !slot || !grantedTo || !["granted", "revoked"].includes(action)) {
    return c.json({ error: "INVALID_PII_GRANT", details: ["trade_id, slot, granted_to, action(granted|revoked) required"] }, 400);
  }
  const ownerActorId = c.get("actorId");
  if (grantedTo === ownerActorId) {
    return c.json({ error: "INVALID_PII_GRANT", details: ["granted_to must be the counterparty, not self"] }, 400);
  }
  const id = ulid();
  // ★mkt-pii-ref.schema.json は additionalProperties:false で `pii_ref_id` という
  // プロパティを持たない(required=trade_id/owner_actor_id/slot/granted_to/action/
  // created_at のみ)。id は Truth キーの一意性にのみ使い、data には含めない。
  const data: Record<string, unknown> = {
    trade_id: tradeId,
    owner_actor_id: ownerActorId,
    slot,
    granted_to: grantedTo,
    action,
    created_at: new Date().toISOString(),
    schema_version: PII_REF_SCHEMA_VERSION,
  };
  const res = await store(c).putEventAt(`truth/${PII_REF_TYPE}/${tradeId}-${id}.json`, envelope(ownerActorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_PII_GRANT", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_PII_GRANT", key: res.key }, 409);
  return c.json({ trade_id: tradeId, slot, granted_to: grantedTo, action }, 201);
});

// GET /market/pii/profile/{owner_actor_id}/{slot}?trade_id=... — 参照(owner本人 or
// 有効な granted な取引相手のみ・A-4リソースロールと同型のowner/viewer2値判定)。
marketPiiRoutes.get("/market/pii/profile/:owner_actor_id/:slot", async (c) => {
  const ownerActorId = c.req.param("owner_actor_id");
  const slot = c.req.param("slot");
  const tradeId = (c.req.query("trade_id") ?? "").trim();
  const actorId = c.get("actorId");

  let role: "owner" | "viewer" | null = null;
  if (actorId === ownerActorId) {
    role = "owner";
  } else if (tradeId) {
    const grant = await latestGrant(store(c), tradeId, ownerActorId, slot, actorId);
    if (grant && grant.action === "granted") role = "viewer";
  }
  if (!role) return c.json({ error: "FORBIDDEN" }, 403);

  const obj = await c.env.TRUTH.get(profileKey(ownerActorId, slot));
  if (!obj) return c.json({ error: "NOT_FOUND" }, 404);
  const profile = JSON.parse(await obj.text()) as Record<string, unknown>;
  if (profile.deleted) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json({ actor_id: ownerActorId, slot, value: profile.value, role });
});
