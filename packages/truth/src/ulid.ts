// ULID: 48-bit ms timestamp (10 chars) + 80-bit randomness (16 chars),
// Crockford Base32 — matches envelope.schema.json id pattern. No dependency.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function ulid(now: number = Date.now()): string {
  let t = now;
  let ts = "";
  for (let i = 0; i < 10; i++) {
    ts = ALPHABET[t % 32] + ts;
    t = Math.floor(t / 32);
  }
  let rnd = "";
  // 256 % 32 === 0 so (byte & 31) is uniform over the alphabet.
  for (const b of crypto.getRandomValues(new Uint8Array(16))) {
    rnd += ALPHABET[b & 31];
  }
  return ts + rnd;
}

export function isUlid(s: string): boolean {
  return ULID_RE.test(s);
}
