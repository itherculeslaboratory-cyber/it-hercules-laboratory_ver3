// FND-04 kernel: pure, IO-free, deterministic state transition (OCC + monotonic
// timestamp + delete-forbidden). This is the reusable reducer; routing every
// real write through it is deferred (design-k7 §5 ceiling).
import { worldHash } from "./hash-chain";

/** A world node. `kind` gates delete-forbidden (record/root are immutable). */
export interface Node {
  kind: string;
  [k: string]: unknown;
}

export interface World {
  snapshotVersion: string;
  lastTimestamp: number;
  nodes: Record<string, Node>;
}

export type Op =
  | { type: "put"; id: string; node: Node }
  | { type: "delete"; id: string };

export interface Command {
  prevSnapshotVersion: string;
  timestamp: number;
  op: Op;
}

export type ReduceResult =
  | { status: "conflict" }
  | { status: "rejected"; reason: "timestamp_not_monotonic" | "delete_forbidden" }
  | { status: "ok"; world: World };

const DELETE_FORBIDDEN_KINDS = new Set(["record", "root"]);

/**
 * Apply `command` to `world`. Judgment order is fixed (design-k7 §1.3):
 *   1. stale prevSnapshotVersion            -> conflict (world unchanged)
 *   2. timestamp <= lastTimestamp           -> rejected timestamp_not_monotonic
 *   3. delete of a record/root node         -> rejected delete_forbidden
 *   4. otherwise                            -> ok, with a fresh worldHash snapshot
 * Deterministic: no Date.now / random — output depends only on inputs.
 */
export async function reduce(
  world: World,
  command: Command,
): Promise<ReduceResult> {
  if (command.prevSnapshotVersion !== world.snapshotVersion) {
    return { status: "conflict" };
  }
  if (command.timestamp <= world.lastTimestamp) {
    return { status: "rejected", reason: "timestamp_not_monotonic" };
  }
  const { op } = command;
  if (
    op.type === "delete" &&
    DELETE_FORBIDDEN_KINDS.has(world.nodes[op.id]?.kind ?? "")
  ) {
    return { status: "rejected", reason: "delete_forbidden" };
  }
  const nodes = { ...world.nodes };
  if (op.type === "put") nodes[op.id] = op.node;
  else delete nodes[op.id];
  return {
    status: "ok",
    world: {
      nodes,
      lastTimestamp: command.timestamp,
      snapshotVersion: await worldHash(nodes),
    },
  };
}
