import { describe, expect, it } from "vitest";
import { rankThreadSearch, type PlazaSearchThread } from "./plaza-routes";

// T-69 KNW wave1 Stage1: tiny deterministic self-check for the "これ?" ranking
// (no embeddings/LLM — plain normalized substring + shared-token matching).
describe("rankThreadSearch", () => {
  it("ranks a matching thread above an unrelated one", () => {
    const threads: PlazaSearchThread[] = [
      { thread_id: "t-kobae", topic: "コバエが大量発生した — 対策まとめ", post_count: 42, latest_at: "2026-07-01T00:00:00.000Z" },
      { thread_id: "t-unrelated", topic: "ヘラクレスの温度管理まとめ", post_count: 5, latest_at: "2026-07-03T00:00:00.000Z" },
    ];
    const matches = rankThreadSearch(threads, "コバエ");
    expect(matches.map((m) => m.thread_id)).toEqual(["t-kobae"]);
  });

  it("ranks a prefix match above a mid-string match", () => {
    const threads: PlazaSearchThread[] = [
      { thread_id: "t-midstring", topic: "トビムシとコバエの見分け・予防", post_count: 18, latest_at: "2026-07-01T00:00:00.000Z" },
      { thread_id: "t-prefix", topic: "コバエが大量発生した — 対策まとめ", post_count: 42, latest_at: "2026-07-01T00:00:00.000Z" },
    ];
    const matches = rankThreadSearch(threads, "コバエ");
    expect(matches[0]?.thread_id).toBe("t-prefix");
  });

  it("ranks an exact-substring match above a single-token overlap", () => {
    const threads: PlazaSearchThread[] = [
      { thread_id: "t-partial", topic: "コバエだけ大量発生", post_count: 1, latest_at: "2026-07-01T00:00:00.000Z" },
      { thread_id: "t-exact", topic: "コバエ対策まとめ", post_count: 1, latest_at: "2026-07-01T00:00:00.000Z" },
    ];
    const matches = rankThreadSearch(threads, "コバエ 対策");
    expect(matches[0]?.thread_id).toBe("t-exact");
    expect(matches[0]?.score).toBeGreaterThan(matches[1]?.score ?? Infinity);
  });

  it("returns no matches for an empty query", () => {
    const threads: PlazaSearchThread[] = [
      { thread_id: "t-1", topic: "何か", post_count: 1, latest_at: "2026-07-01T00:00:00.000Z" },
    ];
    expect(rankThreadSearch(threads, "")).toEqual([]);
    expect(rankThreadSearch(threads, "   ")).toEqual([]);
  });

  it("is deterministic (same input → same output, no random ordering)", () => {
    const threads: PlazaSearchThread[] = [
      { thread_id: "t-a", topic: "コバエ対策A", post_count: 1, latest_at: "2026-07-01T00:00:00.000Z" },
      { thread_id: "t-b", topic: "コバエ対策B", post_count: 1, latest_at: "2026-07-01T00:00:00.000Z" },
    ];
    expect(rankThreadSearch(threads, "コバエ")).toEqual(rankThreadSearch(threads, "コバエ"));
  });

  // T-72 KNW wave1 フォローアップ: 部分文字列/トークンでは拾えない言い換え・
  // 語尾差分を文字bigram Dice係数のファジー加点で拾う(「近い内容があれば
  // これですか?」= ユーザー要件)。実測 dice=0.2308(コメント参照・KNW_FUZZY_FLOOR
  // より上)。
  it("surfaces a non-substring fuzzy match via bigram Dice similarity (real-world phrasing, not a literal substring)", () => {
    const threads: PlazaSearchThread[] = [
      { thread_id: "t-kobae", topic: "コバエが大量発生した — 対策まとめ", post_count: 42, latest_at: "2026-07-01T00:00:00.000Z" },
    ];
    // "コバエがわいた時どうする" is NOT a substring of the topic, and shares no
    // whitespace-delimited token with it either — the pre-fix engine returned [].
    const matches = rankThreadSearch(threads, "コバエがわいた時どうする");
    expect(matches.map((m) => m.thread_id)).toEqual(["t-kobae"]);
    expect(matches[0]?.score).toBeGreaterThan(0);
  });

  it("does NOT surface a genuinely unrelated topic via the fuzzy floor", () => {
    const threads: PlazaSearchThread[] = [
      { thread_id: "t-kobae", topic: "コバエが大量発生した — 対策まとめ", post_count: 42, latest_at: "2026-07-01T00:00:00.000Z" },
      { thread_id: "t-packing", topic: "梱包のコツ", post_count: 3, latest_at: "2026-07-02T00:00:00.000Z" },
    ];
    const matches = rankThreadSearch(threads, "コバエがわいた時どうする");
    expect(matches.map((m) => m.thread_id)).toEqual(["t-kobae"]);
  });
});
