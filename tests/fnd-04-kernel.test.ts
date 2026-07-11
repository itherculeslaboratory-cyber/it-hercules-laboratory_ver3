// V3-FND-04: pure kernel reduce — determinism, OCC conflict, monotonic
// timestamp, delete-forbidden. No IO, no clock; output depends only on inputs.
import { describe, expect, it } from "vitest";
import { reduce, worldHash } from "@ihl/truth";
import type { Command, World } from "@ihl/truth";

async function worldWith(nodes: World["nodes"], lastTimestamp = 0): Promise<World> {
  return { snapshotVersion: await worldHash(nodes), lastTimestamp, nodes };
}

describe("FND-04 kernel reduce", () => {
  it("is deterministic: same world and command give byte-identical results", async () => {
    const world = await worldWith({ n1: { kind: "record", v: 1 } });
    const cmd: Command = {
      prevSnapshotVersion: world.snapshotVersion,
      timestamp: 5,
      op: { type: "put", id: "n2", node: { kind: "record", v: 2 } },
    };
    const a = await reduce(world, cmd);
    const b = await reduce(world, cmd);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.status).toBe("ok");
  });

  it("rejects a stale snapshot version as a conflict, leaving the world unchanged", async () => {
    const world = await worldWith({ n1: { kind: "record", v: 1 } });
    const before = JSON.stringify(world);
    const res = await reduce(world, {
      prevSnapshotVersion: "stale",
      timestamp: 99,
      op: { type: "put", id: "n2", node: { kind: "record", v: 2 } },
    });
    expect(res.status).toBe("conflict");
    expect(JSON.stringify(world)).toBe(before);
  });

  it("rejects a non-monotonic timestamp", async () => {
    const world = await worldWith({ n1: { kind: "record", v: 1 } }, 10);
    const res = await reduce(world, {
      prevSnapshotVersion: world.snapshotVersion,
      timestamp: 10, // <= lastTimestamp
      op: { type: "put", id: "n2", node: { kind: "record", v: 2 } },
    });
    expect(res).toEqual({ status: "rejected", reason: "timestamp_not_monotonic" });
  });

  it("forbids deleting a record or root node", async () => {
    const world = await worldWith({
      r1: { kind: "record", v: 1 },
      leaf: { kind: "leaf", v: 2 },
    });
    const del = await reduce(world, {
      prevSnapshotVersion: world.snapshotVersion,
      timestamp: 1,
      op: { type: "delete", id: "r1" },
    });
    expect(del).toEqual({ status: "rejected", reason: "delete_forbidden" });

    // a non-record/root node may be deleted (ok path proves the guard is scoped).
    const okDel = await reduce(world, {
      prevSnapshotVersion: world.snapshotVersion,
      timestamp: 1,
      op: { type: "delete", id: "leaf" },
    });
    expect(okDel.status).toBe("ok");
    if (okDel.status === "ok") {
      expect("leaf" in okDel.world.nodes).toBe(false);
      expect(okDel.world.lastTimestamp).toBe(1);
    }
  });
});
