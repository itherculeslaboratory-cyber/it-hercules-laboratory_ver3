// 背骨S2: 受領索引(index/receipt/)の書き込み。不変部/可変部分離・conflict時も索引を書く
// 冪等経路(packages/truth/src/index-entry.ts + packages/truth/src/store.ts)。
// 設計正本: proposals/R0801-f383db-DESIGN-2026-08-01-g72-backbonedesign.md §6(論点2/3)・§7 S2行。
import { describe, expect, it } from "vitest";
import { TruthStore, canonicalJson, sha256Hex, ulid, deriveActorId } from "@ihl/truth";
import { FakeR2Bucket, makeEnvelope } from "./helpers";

async function listIndexEntries(
  bucket: FakeR2Bucket,
): Promise<(Record<string, unknown> & { __key: string })[]> {
  const { objects } = await bucket.list({ prefix: "index/receipt/" });
  const out: (Record<string, unknown> & { __key: string })[] = [];
  for (const o of objects) {
    const obj = await bucket.get(o.key);
    if (obj) out.push({ ...(JSON.parse(await obj.text()) as Record<string, unknown>), __key: o.key });
  }
  return out;
}

describe("S2 receipt index (index/receipt/)", () => {
  it("writes exactly one index entry for one inserted event", async () => {
    const bucket = new FakeR2Bucket();
    const store = new TruthStore(bucket);
    const envelope = makeEnvelope();
    const res = await store.putEvent(envelope);
    expect(res.status).toBe("inserted");

    const entries = await listIndexEntries(bucket);
    expect(entries.length).toBe(1);
    expect(entries[0].event_id).toBe(envelope.id);
    expect(entries[0].payload_key).toBe(`truth/${envelope.type}/${envelope.id}.json`);
    expect(entries[0].__key).toMatch(/^index\/receipt\/\d{4}-\d{2}-\d{2}\/\d+-.+\.json$/);
  });

  it("does not duplicate the index entry when the same event is resent (same index key both times)", async () => {
    const bucket = new FakeR2Bucket();
    const store = new TruthStore(bucket);
    const envelope = makeEnvelope();

    const first = await store.putEvent(envelope);
    expect(first.status).toBe("inserted");
    const [firstKey] = (await listIndexEntries(bucket)).map((e) => e.__key);

    const second = await store.putEvent(envelope);
    expect(second.status).toBe("conflict");

    const entriesAfterRetry = await listIndexEntries(bucket);
    expect(entriesAfterRetry.length).toBe(1);
    expect(entriesAfterRetry[0].__key).toBe(firstKey);
  });

  it("still writes the index entry when the payload is a conflict (heals a payload written without an index)", async () => {
    const bucket = new FakeR2Bucket();
    const store = new TruthStore(bucket);
    const envelope = makeEnvelope();
    const originalReceivedAt = "2026-08-01T00:00:00.000Z";

    // payload だけを直接書き込み、索引が無い状態を再現する(索引書き込みが一度失敗した後の
    // 再送シナリオ=§6論点3が守る冪等経路そのもの)。
    await bucket.put(
      `truth/${envelope.type}/${envelope.id}.json`,
      JSON.stringify({ ...envelope, received_at: originalReceivedAt }),
      { onlyIf: { etagDoesNotMatch: "*" } },
    );
    expect((await listIndexEntries(bucket)).length).toBe(0);

    const res = await store.putEvent(envelope);
    expect(res.status).toBe("conflict");

    const entries = await listIndexEntries(bucket);
    expect(entries.length).toBe(1);
    // 索引キー/received_at は「再送した今この瞬間」ではなく、既に保存されている
    // payload の元の received_at から作られる(でないと再送のたびにキーが変わり
    // 冪等にならない)。
    expect(entries[0].received_at).toBe(originalReceivedAt);
    expect(entries[0].__key).toBe(`index/receipt/2026-08-01/${Date.parse(originalReceivedAt)}-${envelope.id}.json`);
  });

  it("text_repr does not leak into event_hash (invariant part excludes the mutable representation)", async () => {
    const bucket = new FakeR2Bucket();
    const store = new TruthStore(bucket);
    const actorId = await deriveActorId("dev@ihl.local");
    const id = ulid();
    const envelope = {
      specversion: "1.0",
      id,
      source: "apps/api",
      type: "ihl.economy.pt_event.v1",
      time: "2026-07-11T00:00:00Z",
      dataschema: "schemas/events/economy-pt-event.schema.json",
      provenance: { generator_kind: "human", actor_id: actorId },
      data: {
        pt_event_id: id,
        actor_id: actorId,
        delta: 5,
        reason_code: "mint",
        created_at: "2026-07-11T00:00:00Z",
        schema_version: "1",
      },
    };

    const res = await store.putEvent(envelope);
    expect(res.status).toBe("inserted");

    const stored = await store.readEvent(`truth/${envelope.type}/${envelope.id}.json`);
    expect(stored).not.toBeNull();

    const entries = await listIndexEntries(bucket);
    expect(entries.length).toBe(1);
    const entry = entries[0];

    // 可変部(text_repr)が実際に生成されていること自体は確認しておく。
    expect(typeof entry.text_repr).toBe("string");
    expect((entry.text_repr as string).length).toBeGreaterThan(0);

    // event_hash は「保存されている envelope そのもの」の canonicalJson ハッシュと厳密に
    // 一致する。stored envelope には text_repr フィールドが存在しない(index専用フィールド
    // であり envelope に混入していない)ので、この再計算が一致すること自体が
    // 「text_repr が event_hash の入力に含まれていない」ことの機械的な証明になる。
    const expectedHash = await sha256Hex(canonicalJson(stored));
    expect(entry.event_hash).toBe(expectedHash);
  });
});
