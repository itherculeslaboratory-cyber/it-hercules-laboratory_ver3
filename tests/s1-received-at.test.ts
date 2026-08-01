// 背骨S1: TruthStore が received_at をサーバ時計で無条件刻印する
// (schemas/events/envelope.schema.json received_at + packages/truth/src/store.ts
// putEvent/putEventAt). 設計正本: proposals/R0801-f383db-DESIGN-2026-08-01-g72-backbonedesign.md §2(D-1)・§7 S1行。
import { describe, expect, it } from "vitest";
import { TruthStore } from "@ihl/truth";
import { FakeR2Bucket, makeEnvelope } from "./helpers";

describe("S1 received_at server-side stamping", () => {
  it("overwrites a spoofed client received_at with the server clock (putEvent)", async () => {
    const store = new TruthStore(new FakeR2Bucket());
    const spoofed = makeEnvelope({ received_at: "1999-01-01T00:00:00.000Z" });
    const before = Date.now();
    const res = await store.putEvent(spoofed);
    const after = Date.now();
    expect(res.status).toBe("inserted");

    const stored = await store.readEvent(`truth/${spoofed.type}/${spoofed.id}.json`);
    expect(stored).not.toBeNull();
    const receivedAt = Date.parse((stored as Record<string, unknown>).received_at as string);
    expect(receivedAt).toBeGreaterThanOrEqual(before);
    expect(receivedAt).toBeLessThanOrEqual(after);
  });

  it("accepts a legacy-shaped event with no received_at field (not required)", async () => {
    const store = new TruthStore(new FakeR2Bucket());
    const legacy = makeEnvelope();
    delete (legacy as Record<string, unknown>).received_at;
    const res = await store.putEvent(legacy);
    expect(res.status).toBe("inserted");
  });

  it("stamps received_at on the stored object (putEventAt)", async () => {
    const store = new TruthStore(new FakeR2Bucket());
    const envelope = makeEnvelope();
    const key = `truth/${envelope.type}/explicit-key.json`;
    const res = await store.putEventAt(key, envelope);
    expect(res.status).toBe("inserted");

    const stored = await store.readEvent(key);
    expect(stored).not.toBeNull();
    expect(typeof (stored as Record<string, unknown>).received_at).toBe("string");
  });
});
