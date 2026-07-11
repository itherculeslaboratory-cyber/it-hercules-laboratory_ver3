// FND-05 hash-chain: deterministic, IO-free tamper-evidence primitives.
// Reuses canonicalJson + sha256Hex (contracts.ts) — no new hash algorithm.
// This is the reusable pure part; wiring every real R2 append into a live
// prev_hash chain is deferred (design-k7 §5 ceiling).
import { canonicalJson, sha256Hex } from "./contracts";

/** Genesis prev_hash sentinel: the prev_hash of the first event in a chain. */
export const GENESIS_HASH = "0".repeat(64);

/**
 * Empty-world sentinel = SHA-256("") = worldHash of zero nodes (empty concat).
 * Pinned as a constant to avoid top-level await (workerd-safe); the FND-05 TC
 * asserts it equals sha256Hex("").
 */
export const EMPTY_WORLD_HASH =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** An event in a hash chain: its own hash, its predecessor's, and core fields. */
export interface ChainEvent {
  prev_hash: string;
  event_hash: string;
  [k: string]: unknown;
}

/** SHA-256(canonicalJson({prev_hash, ...core})). Key order is normalized by canonicalJson. */
export async function eventHash(
  prevHash: string,
  core: Record<string, unknown>,
): Promise<string> {
  return sha256Hex(canonicalJson({ prev_hash: prevHash, ...core }));
}

/**
 * Verify a chain: each event's prev_hash must equal the previous event_hash
 * (GENESIS_HASH for the first), and each event_hash must recompute from its
 * core. brokenAt = index of the first inconsistency, or null when valid.
 */
export async function verifyChain(
  events: ChainEvent[],
): Promise<{ valid: boolean; brokenAt: number | null }> {
  let prev = GENESIS_HASH;
  for (let i = 0; i < events.length; i++) {
    const { prev_hash, event_hash, ...core } = events[i];
    if (prev_hash !== prev) return { valid: false, brokenAt: i };
    if ((await eventHash(prev_hash, core)) !== event_hash) {
      return { valid: false, brokenAt: i };
    }
    prev = event_hash;
  }
  return { valid: true, brokenAt: null };
}

/**
 * Order-independent snapshot hash of a node set: hash each node (canonical),
 * sort the hashes ascending, concat, SHA-256. Empty set → EMPTY_WORLD_HASH.
 * Shared by FND-04 kernel as snapshotVersion.
 */
export async function worldHash(
  nodes: Record<string, unknown>,
): Promise<string> {
  const values = Object.values(nodes);
  if (values.length === 0) return EMPTY_WORLD_HASH;
  const hashes = await Promise.all(values.map((n) => sha256Hex(canonicalJson(n))));
  hashes.sort();
  return sha256Hex(hashes.join(""));
}
