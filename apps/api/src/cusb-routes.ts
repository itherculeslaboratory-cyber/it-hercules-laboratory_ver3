// C5 K1 C-USB(統合入力バス)取り込み API (design-k1 §1.1/§1.2 / V3-OBS-44).
// PROTECTED (index.ts §1.5 gate) — collector と違い署名公開ではなくセッション保護
// (PUBLIC_ROUTES に足さない)。フロー: validate(input_kind) → payload_hash 算出/改ざん
// 検知 → lineage/semantic 付与 → put-if-absent 保存(同 payload = 同 hash = 409)。
// actor_id は常にセッション principal(V3-AUT-17)。envelope/store はインライン。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";

export const cusbRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const CUSB_TYPE = "ihl.cusb.ingest.v1";
const CUSB_SCHEMA = "schemas/events/cusb-ingest.schema.json";
const INPUT_KINDS = new Set(["screen", "api", "sensor", "file", "human", "network"]);

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function envelope(actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id: ulid(),
    source: "apps/api",
    type: CUSB_TYPE,
    time: new Date().toISOString(),
    dataschema: CUSB_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}

// Canonical JSON: recursively sort object keys so the payload hash is independent
// of key order. Arrays keep order (order is semantic). ~10 lines vs a dep.
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = canonical((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let hex = "";
  for (const b of digest) hex += b.toString(16).padStart(2, "0");
  return hex;
}

// POST /cusb — ingest one payload into the unified input bus (OBS-44).
// 400 on: bad body / unknown input_kind / a client-supplied payload_hash that does
// not match the recomputed hash of `payload` (tamper detection). 409 on replay of
// the same payload (put-if-absent, INSERT ONLY). lineage/semantic are stamped here.
cusbRoutes.post("/cusb", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ error: "INVALID_BODY" }, 400);

  const inputKind = body.input_kind;
  if (typeof inputKind !== "string" || !INPUT_KINDS.has(inputKind)) {
    return c.json({ error: "INVALID_INPUT_KIND" }, 400);
  }
  if (body.payload === undefined) return c.json({ error: "MISSING_PAYLOAD" }, 400);

  // payload_hash は payload から一意に再計算する(冪等キー)。クライアントが
  // payload_hash を主張してきた場合は再計算値と照合し、不一致 = 改ざんで 400。
  const payloadHash = await sha256Hex(
    new TextEncoder().encode(JSON.stringify(canonical(body.payload))),
  );
  if (typeof body.payload_hash === "string" && body.payload_hash !== payloadHash) {
    return c.json({ error: "PAYLOAD_HASH_MISMATCH", expected: payloadHash }, 400);
  }

  const actorId = c.get("actorId");
  // lineage/semantic 付与: 取り込み側が入力元メタを刻む。クライアント提供分(object の
  // 場合のみ)を土台にサーバ由来フィールドで上書きし、常に object を保証。
  const clientLineage =
    body.lineage && typeof body.lineage === "object" && !Array.isArray(body.lineage)
      ? (body.lineage as Record<string, unknown>)
      : {};
  const semantic =
    body.semantic && typeof body.semantic === "object" && !Array.isArray(body.semantic)
      ? (body.semantic as Record<string, unknown>)
      : {};
  const lineage: Record<string, unknown> = {
    ...clientLineage,
    input_kind: inputKind,
    ingested_by: actorId,
    ingested_at: new Date().toISOString(),
  };

  const data: Record<string, unknown> = {
    input_kind: inputKind,
    payload_hash: payloadHash,
    lineage,
    semantic,
    actor_id: actorId,
    created_at: new Date().toISOString(),
  };

  const key = `truth/${CUSB_TYPE}/${payloadHash}.json`;
  const res = await store(c).putEventAt(key, envelope(actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_CUSB", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_CUSB", key: res.key }, 409);
  return c.json({ payload_hash: payloadHash, input_kind: inputKind }, 201);
});
