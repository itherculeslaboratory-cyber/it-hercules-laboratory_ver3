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
// roles: V3-AUT-22 ロール claim(任意・後方互換)。非空時のみトークンに載る。
export type SessionPayload = { sub: string; iat: number; exp: number; roles?: string[] };

export async function issueMagicToken(email: string, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signToken({ email, purpose: "magic", iat: now, exp: now + MAGIC_TTL }, secret);
}

export async function issueSessionToken(
  actorId: string,
  secret: string,
  roles: string[] = [],
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { sub: actorId, iat: now, exp: now + SESSION_TTL };
  if (roles.length > 0) payload.roles = roles; // 非空時のみ claim に載せる(後方互換)
  return signToken(payload, secret);
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

// ── V3-AUT-46 数字コード(magic-link と同一OTPの別提示・round-16 OQ-ONB-03)─────────
// 別途トークンを発行/保存せず、magic token と同じ (email, iat, secret) から決定論的に
// 6 桁コードを導出する — サーバは何も追加保存しない(NO server store の不変条項①のまま)。
// 「同一OTP」= magic-link 発行時の iat をそのままコード導出にも使うことで満たす。
export const NUMERIC_CODE_DIGITS = 6;
const CODE_MODULUS = 10 ** NUMERIC_CODE_DIGITS;

async function hmacDigest(input: string, secret: string): Promise<Uint8Array> {
  const key = await hmacKey(secret);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(input)));
}

/** email+iat から決定論的に6桁コードを導出(先頭0埋め)。 */
export async function issueNumericCode(email: string, iat: number, secret: string): Promise<string> {
  const digest = await hmacDigest(`code|${email}|${iat}`, secret);
  const view = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
  return String(view.getUint32(0) % CODE_MODULUS).padStart(NUMERIC_CODE_DIGITS, "0");
}

/**
 * (email, code) から一致する iat を MAGIC_TTL 窓内で逆引きする。トークン実体はサーバに
 * 保存しないため、有効期間内の候補 iat(最大 MAGIC_TTL+1 個・15分=900回程度の HMAC)を
 * 総当りして一致を探す — 軽量(数十 ms オーダー)かつ状態を持たない。一致なしは null。
 */
export async function findMatchingIat(
  email: string,
  code: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<number | null> {
  for (let iat = nowSeconds; iat >= nowSeconds - MAGIC_TTL; iat--) {
    if ((await issueNumericCode(email, iat, secret)) === code) return iat;
  }
  return null;
}
