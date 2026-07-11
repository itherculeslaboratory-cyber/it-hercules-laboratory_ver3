// C5 K1 観測機器 API (design-k1 §1.1 / V3-OBS-31). PROTECTED. A device binds to a
// placement, NOT an individual — an individual-binding request is 400 (the
// obs-device schema carries no individual ref; the route rejects it explicitly
// before Truth). The provider API key is AES-GCM encrypted (api_key_ciphertext);
// the plaintext key is NEVER appended to Truth and NEVER returned — a hard
// security boundary, not a simplification. The AES key is derived from an env
// secret (SESSION_SECRET; test uses the fixed dev secret). Real provider keys are
// a human gate — only a dummy provider's testConnection + the crypto path ship.
// envelope()/store()/dataOf() inlined per the projectLedger precedent (批評家#3).
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";

export const deviceRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const DEVICE_TYPE = "ihl.obs.device.v1";
const DEVICE_SCHEMA = "schemas/events/obs-device.schema.json";

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}
function envelope(actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id: ulid(),
    source: "apps/api",
    type: DEVICE_TYPE,
    time: new Date().toISOString(),
    dataschema: DEVICE_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}

// ── AES-GCM api-key crypto (env-secret-derived key) ─────────────────────────────
async function deviceAesKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("ihl.device.apikey.v1|" + secret),
  );
  return crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
function b64encode(u8: Uint8Array): string {
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s);
}
function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
export async function encryptApiKey(secret: string, plaintext: string): Promise<string> {
  const key = await deviceAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)),
  );
  const packed = new Uint8Array(iv.length + ct.length);
  packed.set(iv);
  packed.set(ct, iv.length);
  return b64encode(packed);
}
export async function decryptApiKey(secret: string, ciphertext: string): Promise<string> {
  const key = await deviceAesKey(secret);
  const packed = b64decode(ciphertext);
  const iv = packed.slice(0, 12);
  const ct = packed.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

// Reject any attempt to bind a device to an individual (OBS-31: placement only).
function bindsIndividual(body: Record<string, unknown>): boolean {
  const sref = body.subject_ref;
  if (typeof sref === "string" && sref.startsWith("individual/")) return true;
  if (body.subject_type === "individual") return true;
  return body.individual_id !== undefined || body.individual_ref !== undefined;
}

// ── dummy provider (real providers = human gate) ────────────────────────────────
// Deterministic auto-discovery derived from the device id — proves the encrypted
// key round-trips (decrypt succeeds) without any real provider network call.
function dummyTestConnection(deviceId: string, apiKey: string | null): { ok: boolean; discovered: string[] } {
  return {
    ok: apiKey !== null, // a stored key that decrypts = connectable
    discovered: apiKey ? [`sensor-${deviceId.slice(0, 6)}-a`, `sensor-${deviceId.slice(0, 6)}-b`] : [],
  };
}

// ── routes ─────────────────────────────────────────────────────────────────────

// POST /devices — register a device (OBS-31). placement binding OK; individual
// binding → 400. api_key (if given) is encrypted; plaintext never persisted.
deviceRoutes.post("/devices", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");
  if (bindsIndividual(body)) {
    return c.json({ error: "DEVICE_INDIVIDUAL_BINDING_FORBIDDEN" }, 400);
  }
  const deviceId = typeof body.device_id === "string" && body.device_id ? body.device_id : ulid();
  const data: Record<string, unknown> = {
    device_id: deviceId,
    provider: typeof body.provider === "string" && body.provider ? body.provider : "dummy",
    display_name: body.display_name,
    actor_id: actorId,
    created_at: new Date().toISOString(),
  };
  if (typeof body.placement_ref === "string") data.placement_ref = body.placement_ref;
  if (typeof body.started_on === "string") data.started_on = body.started_on; // 開始日のみ
  if (typeof body.api_key === "string" && body.api_key) {
    data.api_key_ciphertext = await encryptApiKey(c.env.SESSION_SECRET, body.api_key);
  }
  const res = await store(c).putEventAt(`truth/${DEVICE_TYPE}/${deviceId}.json`, envelope(actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_DEVICE", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_DEVICE", key: res.key }, 409);
  return c.json({ device_id: deviceId, provider: data.provider }, 201);
});

// GET /devices — list with display_name; the plaintext key and its ciphertext are
// NOT exposed (OBS-31: raw ID / api_key 平文非露出).
deviceRoutes.get("/devices", async (c) => {
  const actorId = c.get("actorId");
  const rows = (await store(c).listEvents(`truth/${DEVICE_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.actor_id === actorId) // 本人スコープ
    .map((d) => ({
      device_id: d.device_id,
      display_name: d.display_name,
      provider: d.provider,
      placement_ref: d.placement_ref ?? null,
      started_on: d.started_on ?? null,
      has_api_key: typeof d.api_key_ciphertext === "string",
    }));
  return c.json({ devices: rows });
});

// POST /devices/{id}/test — dummy provider connection test + auto-discovery
// (OBS-31). Decrypts the stored key (exercising the crypto path); real provider
// keys are a human gate and are not invoked here.
deviceRoutes.post("/devices/:id/test", async (c) => {
  const deviceId = c.req.param("id");
  const actorId = c.get("actorId");
  const rec = await store(c).readEvent(`truth/${DEVICE_TYPE}/${deviceId}.json`);
  if (!rec) return c.json({ error: "NOT_FOUND" }, 404);
  const d = dataOf(rec);
  if (d.actor_id !== actorId) return c.json({ error: "NOT_FOUND" }, 404); // 本人スコープ
  let apiKey: string | null = null;
  if (typeof d.api_key_ciphertext === "string") {
    apiKey = await decryptApiKey(c.env.SESSION_SECRET, d.api_key_ciphertext);
  }
  const result = dummyTestConnection(deviceId, apiKey);
  // never echo the plaintext key back — only the connection outcome.
  return c.json({ device_id: deviceId, provider: d.provider, ...result });
});
