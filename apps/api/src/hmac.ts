// Shared inbound-webhook HMAC-SHA256 verification (V3-KRM-13 GitHub /
// V3-MKT-14 GMO). WebCrypto only (crypto.subtle) — no new npm deps, runs in
// workerd. The signature IS the credential: a webhook route is public at the
// session layer and self-gates on verifyHmacSha256 returning true.
//
// Comparison is constant-time (XOR-accumulate over fixed-length digests) so a
// forged signature cannot be distinguished from a near-miss by response timing.

const encoder = new TextEncoder();

/** Decode a hex string to bytes, or null if it is not valid even-length hex. */
function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return null;
    out[i] = byte;
  }
  return out;
}

/** Constant-time byte-array equality (length leak only; digests are fixed 32 B). */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Verify an HMAC-SHA256 signature over rawBody with secret.
 * signatureHeader is hex, optionally prefixed "sha256=" (GitHub
 * X-Hub-Signature-256). GMO sends the same SHA-256 HMAC as raw hex.
 * Returns false (never throws) for missing/malformed input or a mismatch.
 */
export async function verifyHmacSha256(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader || !secret) return false;
  const provided = hexToBytes(signatureHeader.replace(/^sha256=/, "").trim());
  if (!provided) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody)),
  );
  return timingSafeEqual(mac, provided);
}
