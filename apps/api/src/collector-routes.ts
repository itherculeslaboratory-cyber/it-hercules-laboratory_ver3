// Collector ingest (design-c3 §3 / CL-09 / V3-OBS-28). The Ed25519 signature
// IS the credential — this route is PUBLIC at the session layer (index.ts
// PUBLIC_ROUTES) and self-gates on signature verification. A verified reading
// is appended as an ihl.collector.ingest.v1 event attributed to the collector
// (provenance.generator_kind="device"). Tampered/forged signature → 401,
// nothing stored. Key format + canonical_json protocol are UNCHANGED from the
// C1 fixture (tests/fixtures/cl-09-ed25519-fixture.json).
import { Hono } from "hono";
import { TruthStore, canonicalJson, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";

export const collectorRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const INGEST_TYPE = "ihl.collector.ingest.v1";

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
}

// Import an Ed25519 public key from an SPKI PEM (same armor as the C1 fixture).
async function importPublicKey(pem: string): Promise<CryptoKey> {
  const b64 = pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "").replace(/\s+/g, "");
  return crypto.subtle.importKey("spki", b64ToBytes(b64), { name: "Ed25519" }, false, ["verify"]);
}

// Registered public key for a collector_id, or null if unknown.
function publicKeyFor(env: Bindings, collectorId: string): string | null {
  if (!env.COLLECTOR_PUBLIC_KEYS) return null;
  const map = JSON.parse(env.COLLECTOR_PUBLIC_KEYS) as Record<string, string>;
  return typeof map[collectorId] === "string" ? map[collectorId] : null;
}

// POST /collector/ingest — verify Ed25519(signed_message) then append.
// body: { collector_id, timestamp, payload, signature_base64 }.
// signed_message = "<timestamp>.<canonicalJson(payload)>" (fixture protocol).
collectorRoutes.post("/collector/ingest", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    collector_id?: unknown;
    timestamp?: unknown;
    payload?: unknown;
    signature_base64?: unknown;
  } | null;
  if (
    !body ||
    typeof body.collector_id !== "string" ||
    typeof body.timestamp !== "string" ||
    typeof body.signature_base64 !== "string" ||
    typeof body.payload !== "object" ||
    body.payload === null
  ) {
    return c.json({ error: "INVALID_INGEST" }, 400);
  }

  const pem = publicKeyFor(c.env, body.collector_id);
  if (!pem) return c.json({ error: "COLLECTOR_UNKNOWN" }, 401);

  const message = `${body.timestamp}.${canonicalJson(body.payload)}`;
  let ok = false;
  try {
    const key = await importPublicKey(pem);
    ok = await crypto.subtle.verify(
      "Ed25519",
      key,
      b64ToBytes(body.signature_base64),
      new TextEncoder().encode(message),
    );
  } catch {
    ok = false; // malformed key/signature bytes = not verified
  }
  if (!ok) return c.json({ error: "COLLECTOR_SIGNATURE_INVALID" }, 401);

  // Verified reading → append. Truth key is deterministic in (collector_id,
  // timestamp): a byte-identical replay hits the same key → 409 (append-only
  // idempotency, invariant clause ③). envelope.id stays a fresh ULID.
  // ponytail: replay protection = append-only dedupe only. Stale-but-authentic
  // replay (captured elsewhere, first-seen here) is accepted; add a ±max_skew
  // wall-clock guard (ver2 verify_collector_signature) if that threat matters —
  // omitted here because the discarded fixture keypair can't re-sign a fresh
  // timestamp, so a skew guard would be untestable without a live device key.
  const key = `truth/${INGEST_TYPE}/${body.collector_id}-${body.timestamp}.json`;
  const res = await new TruthStore(c.env.TRUTH).putEventAt(key, {
    specversion: "1.0",
    id: ulid(),
    source: body.collector_id,
    type: INGEST_TYPE,
    time: new Date().toISOString(),
    provenance: { generator_kind: "device", device_id: body.collector_id },
    // No dataschema: the payload is an external collector contract
    // (env_collector_ingest_v1), already cryptographically sealed by the
    // verified signature. actor_id carries collector attribution (design-c3 §3).
    data: { collector_id: body.collector_id, actor_id: body.collector_id, signed_at: body.timestamp, payload: body.payload },
  });
  if (res.status === "invalid") return c.json({ error: "INVALID_INGEST", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_INGEST", key: res.key }, 409);
  return c.json({ collector_id: body.collector_id, key: res.key }, 202);
});
