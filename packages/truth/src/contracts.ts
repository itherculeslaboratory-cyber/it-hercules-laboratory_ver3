// ver2-compatible contract ports (CL-03 / CL-08 / CL-09 / CL-11).
// Algorithms pinned by tests/fixtures/* real ver2 vectors — do not "improve".

const encoder = new TextEncoder();

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

/**
 * CL-09 canonical_json (ver2 libs/ihl/env/collector_ingest.py):
 * objects → keys sorted (code-point order, same as Python sorted() for BMP),
 * arrays keep order, scalars via compact JSON. Note: Python json.dumps
 * escapes non-ASCII (ensure_ascii) while JSON.stringify does not — collector
 * payload fields are ASCII per the ingest contract; fixture confirms.
 */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  const obj = v as Record<string, unknown>;
  return (
    "{" +
    Object.keys(obj)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k]))
      .join(",") +
    "}"
  );
}

/**
 * CL-03 actor_id derivation (ver2 libs/ihl/governance/pii.py hash_actor_id):
 * sha256("<salt>:<raw>") hex. Case/whitespace of raw are significant —
 * ver2's normalization inconsistency (strip().lower() vs raw) is pinned by
 * cl-03 vectors; ver3 normalization policy is a C2 decision.
 */
export async function deriveActorId(
  raw: string,
  salt = "ihl-pii-salt",
): Promise<string> {
  const digest = await sha256(`${salt}:${raw}`);
  let hex = "";
  for (const b of digest) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/**
 * CL-11 deriveTransferCode (ver2 libs/ihl/payments/gmo_transfer_code.py):
 * SHA-256(userId utf-8) → first 3 bytes as big-endian uint24 → Base36
 * uppercase → left-pad '0' to 4 → keep last 6 if longer (unreachable:
 * uint24 Base36 max is 5 chars) → "U-" prefix.
 */
export async function deriveTransferCode(userId: string): Promise<string> {
  const digest = await sha256(userId);
  const n = (digest[0] << 16) | (digest[1] << 8) | digest[2];
  let body = n.toString(36).toUpperCase(); // n=0 → "0", same as ver2 base36
  if (body.length < 4) body = body.padStart(4, "0");
  if (body.length > 6) body = body.slice(-6); // mirror ver2; unreachable
  return "U-" + body;
}

/**
 * CL-08 dim guard (ver2 components scoring.py cosine_similarity):
 * raises on shape mismatch, result clamped to [-1, 1].
 */
export function cosineSimilarity(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dim mismatch: (${a.length},) vs (${b.length},)`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const sim = dot / Math.sqrt(na * nb);
  return Math.min(1, Math.max(-1, sim));
}
