// 背骨S3: 日次ルート R_D の導出 + 根に限り put-if-absent 保存(R74-1) + GET /chain/root。
// 設計正本: proposals/R0801-f383db-DESIGN-2026-08-01-g72-backbonedesign.md
// §2論点3(鎖の作り方)・§5論点1(何を根とするか)・§6論点2(不変部のみがルート対象)・§7 S3行。
// HQ裁定: RULING-2026-08-01-gen74-hqrulings.md R74-1(根に限り保存)/R74-2(index.ts 3行限定)。
//
// ★store.putEvent は received_at を常にサーバ実時刻で上書きする(S1の意図通り)ので、任意の
// 過去日付を持つ索引集合を作るには TruthStore を経由せず、index/receipt/<date>/ へ索引
// エントリ(index-entry.ts の IndexEntry 形)を直接書き込む。これは s2-receipt-index.test.ts
// が既に踏んでいる手法(索引はストア層の内部形なのでテストは形を直接組み立てる)と同じ。
import { describe, expect, it } from "vitest";
import { TruthStore, GENESIS_HASH, EMPTY_WORLD_HASH, sha256Hex } from "@ihl/truth";
import app from "../apps/api/src/index";
import { FakeR2Bucket, makeEnv } from "./helpers";
import {
  computeDayRoot,
  deriveDailyRoot,
  ensureDailyRootStored,
  type DailyRoot,
} from "../apps/api/src/chain-routes";

function makeIndexEntry(
  eventId: string,
  date: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    event_id: eventId,
    type: "ihl.test.sample.v1",
    subject: null,
    actor_id: null,
    payload_key: `truth/ihl.test.sample.v1/${eventId}.json`,
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

describe("S3 daily root — computeDayRoot / deriveDailyRoot (design §2論点3/§6論点2)", () => {
  it("① is deterministic: a known index-entry set reproduces the same root", async () => {
    const bucket = new FakeR2Bucket();
    const store = new TruthStore(bucket);
    const date = "2026-08-01";
    await putIndexEntry(bucket, date, makeIndexEntry("ev-a", date));
    await putIndexEntry(bucket, date, makeIndexEntry("ev-b", date));

    const first = await computeDayRoot(store, date);
    const second = await computeDayRoot(store, date);
    expect(first.r).toBe(second.r);
    expect(first.count).toBe(2);
    expect(first.r).not.toBe(EMPTY_WORLD_HASH);
  });

  it("② R_D depends on R_{D-1} (前日ルートとの連結)", async () => {
    const bucket = new FakeR2Bucket();
    const store = new TruthStore(bucket);
    const env = makeEnv(bucket);
    const day1 = "2026-08-01";
    const day2 = "2026-08-02";
    await putIndexEntry(bucket, day1, makeIndexEntry("ev-c", day1));
    await putIndexEntry(bucket, day2, makeIndexEntry("ev-d", day2));

    const root1 = await ensureDailyRootStored(env, day1);
    expect(root1.prev_root).toBe(GENESIS_HASH); // §5論点1: 無い日は genesis 扱い

    const root2 = await deriveDailyRoot(env, day2);
    expect(root2.prev_root).toBe(root1.root);
    const { r: r2 } = await computeDayRoot(store, day2);
    expect(root2.root).toBe(await sha256Hex(root1.root + r2));

    // 前日の索引集合を変えると当日ルートも変わる(連結の実効性の確認)。
    const otherBucket = new FakeR2Bucket();
    const otherStore = new TruthStore(otherBucket);
    const otherEnv = makeEnv(otherBucket);
    await putIndexEntry(otherBucket, day1, makeIndexEntry("ev-e", day1));
    await putIndexEntry(otherBucket, day2, makeIndexEntry("ev-d", day2));
    const otherRoot1 = await ensureDailyRootStored(otherEnv, day1);
    const otherRoot2 = await deriveDailyRoot(otherEnv, day2);
    expect(otherRoot1.root).not.toBe(root1.root);
    expect(otherRoot2.root).not.toBe(root2.root);
    void otherStore;
  });

  it("③ empty day → EMPTY_WORLD_HASH", async () => {
    const bucket = new FakeR2Bucket();
    const store = new TruthStore(bucket);
    const { r, count } = await computeDayRoot(store, "2026-08-03");
    expect(r).toBe(EMPTY_WORLD_HASH);
    expect(count).toBe(0);
  });

  it("④ root storage is put-if-absent: deriving twice yields exactly one stored object with the same value", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const date = "2026-08-04";
    await putIndexEntry(bucket, date, makeIndexEntry("ev-f", date));

    const first = await ensureDailyRootStored(env, date);
    const second = await ensureDailyRootStored(env, date);
    expect(second).toEqual(first);

    const { objects } = await bucket.list({ prefix: `index/root/${date}.json` });
    expect(objects.length).toBe(1);
  });

  it("⑤ text_repr does not leak into the root (mutable part excluded, §6論点2)", async () => {
    const bucket = new FakeR2Bucket();
    const store = new TruthStore(bucket);
    const date = "2026-08-05";
    await putIndexEntry(bucket, date, makeIndexEntry("ev-g", date, { text_repr: "[Foo] type=a subject=b" }));
    const { r: rBefore } = await computeDayRoot(store, date);

    const bucket2 = new FakeR2Bucket();
    const store2 = new TruthStore(bucket2);
    await putIndexEntry(bucket2, date, makeIndexEntry("ev-g", date, { text_repr: "COMPLETELY DIFFERENT TEXT" }));
    const { r: rAfter } = await computeDayRoot(store2, date);

    expect(rAfter).toBe(rBefore);
  });
});

describe("GET /api/v1/chain/root (public read, R74-2 PUBLIC_ROUTES)", () => {
  it("200s without any session (public)", async () => {
    const bucket = new FakeR2Bucket();
    const date = "2026-08-06";
    await putIndexEntry(bucket, date, makeIndexEntry("ev-h", date));

    const res = await app.request(`/api/v1/chain/root?date=${date}`, {}, makeEnv(bucket));
    expect(res.status).toBe(200);
    const body = (await res.json()) as DailyRoot;
    expect(body.date).toBe(date);
    expect(body.event_count).toBe(1);
    expect(body.prev_root).toBe(GENESIS_HASH);
    expect(typeof body.root).toBe("string");
  });

  it("400 INVALID_DATE for a malformed date query", async () => {
    const res = await app.request("/api/v1/chain/root?date=not-a-date", {}, makeEnv());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_DATE" });
  });

  it("repeated GETs for the same date return the same stored root (put-if-absent via the route)", async () => {
    const bucket = new FakeR2Bucket();
    const date = "2026-08-07";
    await putIndexEntry(bucket, date, makeIndexEntry("ev-i", date));
    const env = makeEnv(bucket);

    const first = await (await app.request(`/api/v1/chain/root?date=${date}`, {}, env)).json();
    const second = await (await app.request(`/api/v1/chain/root?date=${date}`, {}, env)).json();
    expect(second).toEqual(first);
  });
});
