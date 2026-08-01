// g80-vis1(design R0801-7b17da §2-3 案C'+補強1/補強2)。E1 横断検索
// (GET /api/v1/search)が非公開captureを別ユーザーへ漏らさないことの回帰テスト。
// 索引エントリは s3-daily-root.test.ts と同じ手法(store層の内部形をテストが直接
// 組み立てる)で bucket に直書きする — buildIndexEntry を経由しない生成物形テストなので
// 「実際に書いたら visibility 列が付く」ことは index-entry.test.ts 側の責務。
import { describe, expect, it } from "vitest";
import { deriveActorId } from "@ihl/truth";
import app from "../apps/api/src/index";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const AUTH = { Authorization: `Bearer ${DEV_TOKEN}` };

function makeIndexEntry(
  eventId: string,
  date: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    event_id: eventId,
    type: "ihl.obs.capture.v1",
    subject: null,
    actor_id: null,
    payload_key: `truth/ihl.obs.capture.v1/${eventId}.json`,
    payload_bytes: 10,
    event_hash: `hash-of-${eventId}`,
    received_at: `${date}T00:00:00.000Z`,
    claimed_at: null,
    sig_alg: null,
    key_id: null,
    sig: null,
    signed_bytes_sha256: null,
    sig_verified: null,
    text_repr: `[Sample] event_id=${eventId}`,
    text_repr_v: 1,
    visibility: null,
    consent_l3: null,
    ...overrides,
  };
}

async function putIndexEntry(
  bucket: FakeR2Bucket,
  date: string,
  entry: Record<string, unknown>,
): Promise<void> {
  const key = `index/receipt/${date}/${entry.event_id}.json`;
  await bucket.put(key, JSON.stringify(entry), { onlyIf: { etagDoesNotMatch: "*" } });
}

async function search(env: object, qs: string) {
  const res = await app.request(`/api/v1/search?${qs}`, { headers: AUTH }, env);
  const body = (await res.json()) as { results: { event_id: string }[] };
  return { status: res.status, ids: body.results.map((r) => r.event_id) };
}

describe("E1 GET /api/v1/search — visibility (g80-vis1 design §2-3 案C'補強1/補強2)", () => {
  it("① 非公開captureが別ユーザーの検索に1行も出ない", async () => {
    const bucket = new FakeR2Bucket();
    const date = "2026-08-15";
    await putIndexEntry(
      bucket,
      date,
      makeIndexEntry("ev-private", date, { visibility: "private", actor_id: "someone-else" }),
    );
    const { ids } = await search(makeEnv(bucket), `from=${date}&to=${date}`);
    expect(ids).not.toContain("ev-private");
  });

  it("② 所有者本人には出る", async () => {
    const bucket = new FakeR2Bucket();
    const date = "2026-08-16";
    const ownerActorId = await deriveActorId("dev@ihl.local"); // DEV_TOKEN経路の固定actorId
    await putIndexEntry(
      bucket,
      date,
      makeIndexEntry("ev-mine", date, { visibility: "private", actor_id: ownerActorId }),
    );
    const { ids } = await search(makeEnv(bucket), `from=${date}&to=${date}`);
    expect(ids).toContain("ev-mine");
  });

  it("③ 公開captureは誰でも出る(回帰: 許可リストがcapture自体まで塞いでいない)", async () => {
    const bucket = new FakeR2Bucket();
    const date = "2026-08-17";
    await putIndexEntry(
      bucket,
      date,
      makeIndexEntry("ev-public", date, { visibility: "public", actor_id: "someone-else" }),
    );
    const { ids } = await search(makeEnv(bucket), `from=${date}&to=${date}`);
    expect(ids).toContain("ev-public");
  });

  it("④ 許可リスト外の型(visibility列の判定規則が無い型)は出ない(既定拒否・補強2)", async () => {
    const bucket = new FakeR2Bucket();
    const date = "2026-08-18";
    await putIndexEntry(
      bucket,
      date,
      makeIndexEntry("ev-photo", date, { type: "ihl.obs.photo.v1", visibility: null, actor_id: null }),
    );
    const { ids } = await search(makeEnv(bucket), `from=${date}&to=${date}`);
    expect(ids).not.toContain("ev-photo");
  });
});
