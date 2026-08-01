// g77-apifix: dev-login 500 根治の回帰テスト。writeIndexEntry の conflict 分岐が
// received_at の無い旧形式レコードを読んだ時に indexKeyFor() の .slice(0,10) で
// 例外化していた(TypeError: Cannot read properties of undefined (reading 'slice'))。
// 設計正本: packages/truth/src/store.ts writeIndexEntry()。
import { describe, expect, it } from "vitest";
import { TruthStore } from "@ihl/truth";
import { FakeR2Bucket, makeEnvelope } from "./helpers";

describe("g77-apifix: legacy record without received_at does not crash index write", () => {
  it("putEvent on a conflicting key whose stored payload lacks received_at does not throw, and skips the index write", async () => {
    const bucket = new FakeR2Bucket();
    const store = new TruthStore(bucket);
    const envelope = makeEnvelope();

    // 旧形式レコードを再現: received_at フィールドの無い envelope をそのまま payload
    // キーへ直接書く(received_at 導入前のデータ形)。
    const legacy = { ...envelope };
    delete (legacy as Record<string, unknown>).received_at;
    await bucket.put(`truth/${envelope.type}/${envelope.id}.json`, JSON.stringify(legacy), {
      onlyIf: { etagDoesNotMatch: "*" },
    });

    // 同じキーへの再送 → payload は conflict。旧修正前はここで writeIndexEntry が
    // indexKeyFor(source) を呼び、source.received_at.slice(0,10) が例外化していた。
    await expect(store.putEvent(envelope)).resolves.toEqual({
      status: "conflict",
      key: `truth/${envelope.type}/${envelope.id}.json`,
    });

    // 索引は安全に導出できないためスキップされ、書き込まれない(索引0件)。
    const { objects } = await bucket.list({ prefix: "index/receipt/" });
    expect(objects.length).toBe(0);
  });

  it("does not affect the normal path: a fresh record still gets exactly one index entry", async () => {
    const bucket = new FakeR2Bucket();
    const store = new TruthStore(bucket);
    const envelope = makeEnvelope();
    const res = await store.putEvent(envelope);
    expect(res.status).toBe("inserted");
    const { objects } = await bucket.list({ prefix: "index/receipt/" });
    expect(objects.length).toBe(1);
  });
});
