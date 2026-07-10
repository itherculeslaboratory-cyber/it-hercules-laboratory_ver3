// Signed stateless session/magic tokens — WebCrypto HMAC-SHA256 only.
// Format: v1.<payload_b64url>.<sig_b64url>, sig = HMAC-SHA256("v1.<payload_b64url>", SESSION_SECRET).
// NO JWT library (invariant clause ① / V3-AUT-03). Stateless: no server store,
// no forced revocation (KV denylist deferred to requirement time — 第6回裁定).

const enc = new TextEncoder();
const dec = new TextDecoder();

export const MAGIC_TTL = 15 * 60; // 15 min
export const SESSION_TTL = 30 * 24 * 60 * 60; // 30 days

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Low-level sign (exported for tests to craft arbitrary payloads). */
export async function signToken(payload: object, secret: string): Promise<string> {
  const payloadB64 = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const signingInput = `v1.${payloadB64}`;
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(signingInput)));
  return `${signingInput}.${b64urlEncode(sig)}`;
}

/** Low-level verify: signature + exp. Returns payload object or null. */
export async function verifyToken(
  token: string,
  secret: string,
): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const signingInput = `v1.${parts[1]}`;
  let sigBytes: Uint8Array;
  try {
    sigBytes = b64urlDecode(parts[2]);
  } catch {
    return null;
  }
  const key = await hmacKey(secret);
  // crypto.subtle.verify is constant-time — do not hand-roll a byte compare.
  const ok = await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(signingInput));
  if (!ok) return null;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(dec.decode(b64urlDecode(parts[1])));
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}

export type MagicPayload = { email: string; purpose: "magic"; iat: number; exp: number };
export type SessionPayload = { sub: string; iat: number; exp: number };

export async function issueMagicToken(email: string, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signToken({ email, purpose: "magic", iat: now, exp: now + MAGIC_TTL }, secret);
}

export async function issueSessionToken(actorId: string, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signToken({ sub: actorId, iat: now, exp: now + SESSION_TTL }, secret);
}

export async function verifyMagicToken(token: string, secret: string): Promise<MagicPayload | null> {
  const p = await verifyToken(token, secret);
  if (!p || p.purpose !== "magic" || typeof p.email !== "string") return null;
  return p as MagicPayload;
}

export async function verifySessionToken(token: string, secret: string): Promise<SessionPayload | null> {
  const p = await verifyToken(token, secret);
  // Reject purpose-mixing: a magic token (has `purpose`) must never authenticate a session.
  if (!p || "purpose" in p || typeof p.sub !== "string") return null;
  return p as SessionPayload;
}
