// V3-FND-05: hash-chain tamper evidence — valid chains verify, a mutated event
// is caught at its index, worldHash is order-independent, empty world sentinel.
import { describe, expect, it } from "vitest";
import {
  EMPTY_WORLD_HASH,
  eventHash,
  sha256Hex,
  verifyChain,
  worldHash,
} from "@ihl/truth";
import type { ChainEvent } from "@ihl/truth";

const GENESIS = "0".repeat(64);

// Build a well-formed chain from a list of event cores.
async function buildChain(cores: Record<string, unknown>[]): Promise<ChainEvent[]> {
  const events: ChainEvent[] = [];
  let prev = GENESIS;
  for (const core of cores) {
    const event_hash = await eventHash(prev, core);
    events.push({ prev_hash: prev, event_hash, ...core });
    prev = event_hash;
  }
  return events;
}

describe("FND-05 hash chain", () => {
  it("verifies a well-formed chain", async () => {
    const chain = await buildChain([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(await verifyChain(chain)).toEqual({ valid: true, brokenAt: null });
  });

  it("detects a tampered event via event_hash recomputation", async () => {
    const chain = await buildChain([{ n: 1 }, { n: 2 }, { n: 3 }]);
    // mutate the core of event index 1 without recomputing its stored hash.
    (chain[1] as Record<string, unknown>).n = 999;
    expect(await verifyChain(chain)).toEqual({ valid: false, brokenAt: 1 });
  });

  it("computes worldHash order-independently and returns the empty sentinel", async () => {
    const a = await worldHash({ x: { kind: "record", v: 1 }, y: { kind: "record", v: 2 } });
    const b = await worldHash({ y: { kind: "record", v: 2 }, x: { kind: "record", v: 1 } });
    expect(a).toBe(b);

    expect(await worldHash({})).toBe(EMPTY_WORLD_HASH);
    // pin the sentinel to SHA-256("") so the constant can't silently drift.
    expect(EMPTY_WORLD_HASH).toBe(await sha256Hex(""));
  });
});
