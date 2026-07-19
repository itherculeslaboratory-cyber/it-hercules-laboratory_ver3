import { describe, expect, it } from "vitest";
import {
  classifyPromotion,
  reduceSpeciesBook,
  type SpeciesBookPostInput,
  type SpeciesBookHistoryEntry,
} from "./plaza-routes";

// wave1 KNW「種族の本」: reduceSpeciesBook is a pure function (store-independent,
// same shape as rankThreadSearch/dedupVotes/reduceForkRank). Chapters key on
// species_id×topic only — board_kind is never consulted here.

const zeroCounts = { cite_count: 0, retry_reproduced: 0, retry_not_reproduced: 0, stance_total: 0 };

describe("classifyPromotion", () => {
  it("verified when cite_count>=4 and retry_reproduced>=2", () => {
    expect(classifyPromotion({ ...zeroCounts, cite_count: 4, retry_reproduced: 2 })).toBe("verified");
  });

  it("refuted takes priority over verified when retry_not_reproduced>=5", () => {
    expect(
      classifyPromotion({ cite_count: 4, retry_reproduced: 2, retry_not_reproduced: 5, stance_total: 0 }),
    ).toBe("refuted");
  });

  it("unresolved when neither verified nor refuted but stance_total>=12", () => {
    expect(classifyPromotion({ ...zeroCounts, stance_total: 12 })).toBe("unresolved");
  });

  it("open when nothing meets a threshold", () => {
    expect(classifyPromotion(zeroCounts)).toBe("open");
  });
});

describe("reduceSpeciesBook", () => {
  const post = (over: Partial<SpeciesBookPostInput>): SpeciesBookPostInput => ({
    post_id: "p-0",
    thread_id: "t-0",
    topic: "topic",
    body: "body",
    created_at: "2026-07-01T00:00:00.000Z",
    observation_cite_count: 0,
    ...over,
  });

  it("returns an empty book for no posts", () => {
    const book = reduceSpeciesBook("sp-1", "ヘラクレスオオカブト", [], {}, {});
    expect(book).toEqual({
      species_id: "sp-1",
      species_name: "ヘラクレスオオカブト",
      chapter_count: 0,
      thread_count: 0,
      verified_count: 0,
      chapters: [],
    });
  });

  it("groups chapters by topic (not board_kind, which is never passed in), orders post_count desc then topic asc, and classifies status from summed thread counts", () => {
    // topic「最適温度」: 1 thread, summed counts reach verified (cite=4, retry_reproduced=2).
    const posts: SpeciesBookPostInput[] = [
      post({ post_id: "p-a1", thread_id: "t-temp", topic: "最適温度", body: "26-28度が目安", observation_cite_count: 3, created_at: "2026-07-01T00:00:00.000Z" }),
      post({ post_id: "p-a2", thread_id: "t-temp", topic: "最適温度", body: "28度が最も産卵率が高い", observation_cite_count: 5, created_at: "2026-07-02T00:00:00.000Z" }),
      // topic「コバエ対策」: 2 threads, summed counts stay below every threshold → open.
      post({ post_id: "p-b1", thread_id: "t-kobae-1", topic: "コバエ対策", body: "麻布を使う", observation_cite_count: 1, created_at: "2026-07-03T00:00:00.000Z" }),
      post({ post_id: "p-b2", thread_id: "t-kobae-2", topic: "コバエ対策", body: "防虫ネットを使う", observation_cite_count: 1, created_at: "2026-07-04T00:00:00.000Z" }),
      post({ post_id: "p-b3", thread_id: "t-kobae-2", topic: "コバエ対策", body: "冷蔵庫保管も効く", observation_cite_count: 0, created_at: "2026-07-05T00:00:00.000Z" }),
    ];
    const promotionByThread = {
      "t-temp": { cite_count: 4, retry_reproduced: 2, retry_not_reproduced: 0, stance_total: 0 },
      "t-kobae-1": { cite_count: 1, retry_reproduced: 0, retry_not_reproduced: 0, stance_total: 1 },
      "t-kobae-2": { cite_count: 1, retry_reproduced: 0, retry_not_reproduced: 0, stance_total: 1 },
    };
    const book = reduceSpeciesBook("sp-1", "ヘラクレスオオカブト", posts, promotionByThread, {});

    expect(book.chapter_count).toBe(2);
    expect(book.thread_count).toBe(3);
    expect(book.verified_count).toBe(1);
    // post_count desc: コバエ対策(3) before 最適温度(2).
    expect(book.chapters.map((ch) => ch.topic)).toEqual(["コバエ対策", "最適温度"]);

    const temp = book.chapters.find((ch) => ch.topic === "最適温度")!;
    expect(temp.thread_count).toBe(1);
    expect(temp.status).toBe("verified");
    expect(temp.answer_verified).toBe(true);
    // answer = post with the highest observation_cite_count (p-a2, count 5).
    expect(temp.answer).toBe("28度が最も産卵率が高い");

    const kobae = book.chapters.find((ch) => ch.topic === "コバエ対策")!;
    expect(kobae.thread_count).toBe(2);
    expect(kobae.status).toBe("open");
    expect(kobae.answer_verified).toBe(false);
  });

  it("breaks an answer tie (equal observation_cite_count) by newest created_at, then post_id ascending", () => {
    const posts: SpeciesBookPostInput[] = [
      post({ post_id: "p-2", thread_id: "t-1", topic: "餌", body: "ゼリーが良い", observation_cite_count: 2, created_at: "2026-07-01T00:00:00.000Z" }),
      post({ post_id: "p-1", thread_id: "t-1", topic: "餌", body: "昆虫マットが良い", observation_cite_count: 2, created_at: "2026-07-03T00:00:00.000Z" }),
      post({ post_id: "p-3", thread_id: "t-1", topic: "餌", body: "バナナも食べる", observation_cite_count: 2, created_at: "2026-07-03T00:00:00.000Z" }),
    ];
    const book = reduceSpeciesBook("sp-1", "sp-1", posts, {}, {});
    // Newest created_at wins first (p-1 and p-3 tie at 07-03) → tie broken by post_id asc → p-1.
    expect(book.chapters[0]?.answer).toBe("昆虫マットが良い");
  });

  it("falls back to the latest post's body when no post has any observation citation", () => {
    const posts: SpeciesBookPostInput[] = [
      post({ post_id: "p-1", thread_id: "t-1", topic: "湿度", body: "60%前後", observation_cite_count: 0, created_at: "2026-07-01T00:00:00.000Z" }),
      post({ post_id: "p-2", thread_id: "t-1", topic: "湿度", body: "70%前後が良いという説も", observation_cite_count: 0, created_at: "2026-07-02T00:00:00.000Z" }),
    ];
    const book = reduceSpeciesBook("sp-1", "sp-1", posts, {}, {});
    expect(book.chapters[0]?.answer).toBe("70%前後が良いという説も");
  });

  it("concatenates history across all threads of a topic, sorted by at ascending", () => {
    const posts: SpeciesBookPostInput[] = [
      post({ post_id: "p-1", thread_id: "t-1", topic: "産卵", body: "b1", created_at: "2026-07-01T00:00:00.000Z" }),
      post({ post_id: "p-2", thread_id: "t-2", topic: "産卵", body: "b2", created_at: "2026-07-02T00:00:00.000Z" }),
    ];
    const historyByThread: Record<string, SpeciesBookHistoryEntry[]> = {
      "t-1": [{ diff: "初版", at: "2026-07-05T00:00:00.000Z" }],
      "t-2": [{ diff: "追記1", at: "2026-07-02T00:00:00.000Z" }, { diff: "追記2", at: "2026-07-10T00:00:00.000Z" }],
    };
    const book = reduceSpeciesBook("sp-1", "sp-1", posts, {}, historyByThread);
    expect(book.chapters[0]?.history.map((h) => h.diff)).toEqual(["追記1", "初版", "追記2"]);
  });

  it("is deterministic (same input → same output)", () => {
    const posts: SpeciesBookPostInput[] = [
      post({ post_id: "p-1", thread_id: "t-1", topic: "温度", body: "b1", observation_cite_count: 1 }),
      post({ post_id: "p-2", thread_id: "t-2", topic: "湿度", body: "b2", observation_cite_count: 2 }),
    ];
    const a = reduceSpeciesBook("sp-1", "name", posts, {}, {});
    const b = reduceSpeciesBook("sp-1", "name", posts, {}, {});
    expect(a).toEqual(b);
  });
});
