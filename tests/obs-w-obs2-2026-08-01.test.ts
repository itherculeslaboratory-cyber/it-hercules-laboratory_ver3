// w-obs2(2026-08-01) 検証: V3-OBS-54段階2/3(可視性ゲート)+V3-OBS-69(統計投影・純関数)。
// PURE — no IO/TruthStore(captureVisibleTo/projectGrowthRate/pearsonCorrelationは
// いずれもpure export)。route配線自体はライブTRUTHバインディングが要るため既存の
// obs-w2-wave2.test.ts等の統合テストの枠外とし、ここでは各関数のロジックのみ検証する。
import { describe, expect, it, vi } from "vitest";
import {
  captureVisibleTo,
  projectGrowthRate,
  pearsonCorrelation,
  lookupGbifCanonicalId,
  lookupWikidataQid,
  groupMeanByField,
  headersContainSecret,
  executeDatasourceFetch,
} from "../apps/api/src/observation-routes";

describe("V3-OBS-54段階2/3 / A-8-b captureVisibleTo", () => {
  it("visibility未指定(既定public)は誰でも見える(未ログイン含む)", () => {
    expect(captureVisibleTo({ actor_id: "u1" }, undefined)).toBe(true);
    expect(captureVisibleTo({ actor_id: "u1" }, "u2")).toBe(true);
  });

  it("visibility=public は誰でも見える", () => {
    expect(captureVisibleTo({ actor_id: "u1", visibility: "public" }, undefined)).toBe(true);
  });

  it("visibility=private は本人のみ。他人・未ログインは見えない", () => {
    const cap = { actor_id: "u1", visibility: "private" };
    expect(captureVisibleTo(cap, "u1")).toBe(true);
    expect(captureVisibleTo(cap, "u2")).toBe(false);
    expect(captureVisibleTo(cap, undefined)).toBe(false);
  });

  it("visibility=uid_linked はログイン済みなら誰でも、未ログインは見えない", () => {
    const cap = { actor_id: "u1", visibility: "uid_linked" };
    expect(captureVisibleTo(cap, "u1")).toBe(true);
    expect(captureVisibleTo(cap, "u2")).toBe(true);
    expect(captureVisibleTo(cap, undefined)).toBe(false);
  });
});

describe("V3-OBS-69 projectGrowthRate", () => {
  it("2点以上・時間差ありなら (最新-最古)/経過日数 を返す", () => {
    const r = projectGrowthRate([
      { value: 10, at: "2026-01-01T00:00:00.000Z" },
      { value: 30, at: "2026-01-11T00:00:00.000Z" }, // 10日後
    ]);
    expect(r.n).toBe(2);
    expect(r.rate_per_day).toBeCloseTo(2, 5); // (30-10)/10日
  });

  it("1点のみ・0点・経過0日は推測せずnull", () => {
    expect(projectGrowthRate([]).rate_per_day).toBeNull();
    expect(projectGrowthRate([{ value: 10, at: "2026-01-01T00:00:00.000Z" }]).rate_per_day).toBeNull();
    expect(
      projectGrowthRate([
        { value: 10, at: "2026-01-01T00:00:00.000Z" },
        { value: 12, at: "2026-01-01T00:00:00.000Z" },
      ]).rate_per_day,
    ).toBeNull();
  });

  it("非数値・不正日付は除外してから計算する", () => {
    const r = projectGrowthRate([
      { value: NaN, at: "2026-01-01T00:00:00.000Z" },
      { value: 10, at: "2026-01-01T00:00:00.000Z" },
      { value: 20, at: "2026-01-06T00:00:00.000Z" },
    ]);
    expect(r.n).toBe(2);
    expect(r.rate_per_day).toBeCloseTo(2, 5);
  });
});

describe("V3-OBS-69 pearsonCorrelation", () => {
  it("完全な正の相関 -> 1", () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 6);
  });

  it("完全な負の相関 -> -1", () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 6);
  });

  it("n<2 または分散0はnull(でっち上げない)", () => {
    expect(pearsonCorrelation([1], [1])).toBeNull();
    expect(pearsonCorrelation([5, 5, 5], [1, 2, 3])).toBeNull();
  });
});

describe("V3-OBS-04 lookupGbifCanonicalId / lookupWikidataQid(注入fetcher・実ネットワーク非依存)", () => {
  it("GBIF: matchType!=NONE かつ usageKey数値 -> 文字列IDを返す", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ usageKey: 1234567, matchType: "EXACT" }), { status: 200 }));
    await expect(lookupGbifCanonicalId("Dynastes hercules", fetcher as unknown as typeof fetch)).resolves.toBe("1234567");
  });

  it("GBIF: matchType=NONE はnull(一致なしをでっち上げない)", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ matchType: "NONE" }), { status: 200 }));
    await expect(lookupGbifCanonicalId("xxx-not-a-species", fetcher as unknown as typeof fetch)).resolves.toBeNull();
  });

  it("GBIF: HTTPエラー/例外はベストエフォート劣化でnull(routeを落とさない)", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 500 }));
    await expect(lookupGbifCanonicalId("x", fetcher as unknown as typeof fetch)).resolves.toBeNull();
    const throwing = vi.fn(async () => { throw new Error("network down"); });
    await expect(lookupGbifCanonicalId("x", throwing as unknown as typeof fetch)).resolves.toBeNull();
  });

  it("Wikidata: search[0].id がQ番号形式なら返す", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ search: [{ id: "Q123456" }] }), { status: 200 }));
    await expect(lookupWikidataQid("Dynastes hercules", fetcher as unknown as typeof fetch)).resolves.toBe("Q123456");
  });

  it("Wikidata: 結果0件・Q番号形式でない・エラーはnull", async () => {
    const empty = vi.fn(async () => new Response(JSON.stringify({ search: [] }), { status: 200 }));
    await expect(lookupWikidataQid("x", empty as unknown as typeof fetch)).resolves.toBeNull();
    const malformed = vi.fn(async () => new Response(JSON.stringify({ search: [{ id: "not-a-qid" }] }), { status: 200 }));
    await expect(lookupWikidataQid("x", malformed as unknown as typeof fetch)).resolves.toBeNull();
  });
});

describe("V3-OBS-69 groupMeanByField(Ver別/ロット別比較)", () => {
  it("groupKeyごとに平均を計算する", () => {
    const out = groupMeanByField([
      { groupKey: "lot-a", value: 10 },
      { groupKey: "lot-a", value: 20 },
      { groupKey: "lot-b", value: 5 },
    ]);
    expect(out).toEqual([
      { group: "lot-a", mean: 15, n: 2 },
      { group: "lot-b", mean: 5, n: 1 },
    ]);
  });

  it("groupKey未設定・value欠測(null)は集計から除外する(0扱いしない)", () => {
    const out = groupMeanByField([
      { groupKey: undefined, value: 100 },
      { groupKey: "lot-a", value: null },
      { groupKey: "lot-a", value: 10 },
    ]);
    expect(out).toEqual([{ group: "lot-a", mean: 10, n: 1 }]);
  });
});

describe("V3-OBS-64 headersContainSecret(第20回裁定DK-1整合・秘密ヘッダの取り違え禁止)", () => {
  it("Authorization/APIキー系のキーを検出する(大小無視)", () => {
    expect(headersContainSecret({ Authorization: "Bearer x" })).toBe(true);
    expect(headersContainSecret({ "x-api-key": "x" })).toBe(true);
    expect(headersContainSecret({ APIKEY: "x" })).toBe(true);
    expect(headersContainSecret({ Cookie: "x" })).toBe(true);
  });

  it("非秘密ヘッダ(Accept等)は通す", () => {
    expect(headersContainSecret({ Accept: "application/json" })).toBe(false);
    expect(headersContainSecret(undefined)).toBe(false);
    expect(headersContainSecret({})).toBe(false);
  });
});

describe("V3-OBS-64 executeDatasourceFetch(注入fetcher・実ネットワーク非依存)", () => {
  it("成功時は ok/status/body を返す", async () => {
    const fetcher = vi.fn(async () => new Response("hello", { status: 200 }));
    const r = await executeDatasourceFetch({ method: "GET", url: "https://example.invalid/x" }, fetcher as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, status: 200, body: "hello" });
  });

  it("例外はベストエフォート劣化(ok:false, status:0)でrouteを落とさない", async () => {
    const throwing = vi.fn(async () => { throw new Error("dns fail"); });
    const r = await executeDatasourceFetch({ method: "GET", url: "https://example.invalid/x" }, throwing as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(0);
  });
});
