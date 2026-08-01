// C5 K1 match preference TC (design-k1 §3 / V3-IND-07). Drives the real app
// through the auth gate (DEV_TOKEN bearer). Preference weight is w←w+α·y·x;
// ranking is inner-product descending and the score is NOT exposed.
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, deriveActorId } from "@ihl/truth";
import { projectPreferenceWeights, rankByPreference, projectMatchConvergence, computeMatchFeatures } from "../apps/api/src/match-routes";
import { MATCH_FEATURE_TAG_VOCAB } from "../apps/api/src/observation-constants";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const JSON_HEADERS = { "content-type": "application/json" };
const AUTH = { Authorization: `Bearer ${DEV_TOKEN}` };
const AUTH_JSON = { ...AUTH, ...JSON_HEADERS };
const DEV_ACTOR = await deriveActorId("dev@ihl.local");

function ctx() {
  const bucket = new FakeR2Bucket();
  return { bucket, env: makeEnv(bucket) };
}
async function pref(env: object, body: Record<string, unknown>) {
  return app.request("/api/v1/match/preference", { method: "POST", headers: AUTH_JSON, body: JSON.stringify(body) }, env);
}
async function createInd(env: object, body: Record<string, unknown> = {}): Promise<string> {
  const res = await app.request("/api/v1/individuals", { method: "POST", headers: AUTH_JSON, body: JSON.stringify(body) }, env);
  return ((await res.json()) as { individual_id: string }).individual_id;
}
async function pairChoice(env: object, body: Record<string, unknown>) {
  return app.request("/api/v1/match/pair-choice", { method: "POST", headers: AUTH_JSON, body: JSON.stringify(body) }, env);
}

describe("IND-07 preference learning w <- w + alpha*y*x", () => {
  it("reduces preference events into a weight vector", async () => {
    const { env, bucket } = ctx();
    await pref(env, { item_id: "A", kind: "swipe", y: 1, features: [1, 0] });
    await pref(env, { item_id: "B", kind: "pass", y: -1, features: [0, 1] });
    const w = await projectPreferenceWeights(new TruthStore(bucket), DEV_ACTOR);
    expect(w[0]).toBeCloseTo(0.1, 10); // +alpha*(+1)*1
    expect(w[1]).toBeCloseTo(-0.1, 10); // +alpha*(-1)*1
  });

  it("ranking is inner-product descending and never leaks score", async () => {
    const { env } = ctx();
    await pref(env, { item_id: "A", kind: "swipe", y: 1, features: [1, 0] });
    await pref(env, { item_id: "B", kind: "pass", y: -1, features: [0, 1] });
    const body = (await (await app.request("/api/v1/match/ranking", { headers: AUTH }, env)).json()) as {
      ranking: Record<string, unknown>[];
    };
    expect(body.ranking.map((r) => r.item_id)).toEqual(["A", "B"]); // dot(w,A)=.1 > dot(w,B)=-.1
    for (const item of body.ranking) {
      expect("score" in item).toBe(false);
      expect("features" in item).toBe(false);
    }
  });

  it("valuecheck kind is accepted; invalid y is rejected 400", async () => {
    const { env } = ctx();
    expect((await pref(env, { item_id: "C", kind: "valuecheck", y: 1, features: [0.5] })).status).toBe(201);
    // y:0 は D2拡張(uib02think §4-2)により pairwise の neither 用に enum へ追加済み=もはや無効値ではない
    // (この行はスキーマ拡張前は y:0 で400を確認していたが、拡張後の正しい無効値=範囲外の2へ差し替えた)。
    expect((await pref(env, { item_id: "D", kind: "swipe", y: 2, features: [1] })).status).toBe(400);
    expect((await pref(env, { item_id: "E", kind: "nope", y: 1, features: [1] })).status).toBe(400);
  });
});

describe("uib02pre T2(=uib02think設計E3): match-preference D2拡張(kind:pairwise/y:0/pair_id)", () => {
  it("(a) kind:pairwise + y:0 + pair_id 付きイベントはスキーマvalidationを通る", async () => {
    const { env } = ctx();
    const res = await pref(env, { item_id: "left1", kind: "pairwise", y: 0, features: [1, 0], pair_id: "round-1" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { kind: string };
    expect(body.kind).toBe("pairwise");
  });

  it("(b) pair_id 無しの既存形(swipe/valuecheck)は引き続き通る(後方互換)", async () => {
    const { env } = ctx();
    expect((await pref(env, { item_id: "s1", kind: "swipe", y: 1, features: [1] })).status).toBe(201);
    expect((await pref(env, { item_id: "v1", kind: "valuecheck", y: -1, features: [1] })).status).toBe(201);
  });

  it("(c) y=0(neither)混在時、precision@Kの分母から除外される", async () => {
    const { env, bucket } = ctx();
    // 1件だけ正解(y=1)、残りneither(y=0)。y=0を分母に含めると precision@2 は 1/2=0.5 に不当に下がる。
    // 分母から除外されていれば分母は1件のみ(y!=0)となり precision@2=1/1=1 になる。
    await pref(env, { item_id: "p1", kind: "swipe", y: 1, features: [1, 0] });
    await pref(env, { item_id: "p2", kind: "pairwise", y: 0, features: [0, 1], pair_id: "r1" });
    await pref(env, { item_id: "p3", kind: "pairwise", y: 0, features: [0, 1], pair_id: "r1" });
    const report = await projectMatchConvergence(new TruthStore(bucket), DEV_ACTOR, 2);
    expect(report.precision_at_k).toEqual({ k: 1, value: 1 });
  });
});

describe("IND-07 rankByPreference pure fn", () => {
  it("orders by w·x descending, stable on ties, strips features", () => {
    const w = [1, 0];
    const out = rankByPreference(w, [
      { item_id: "lo", features: [0, 1] },
      { item_id: "hi", features: [2, 0] },
      { item_id: "mid", features: [1, 0] },
    ]);
    expect(out.map((o) => o.item_id)).toEqual(["hi", "mid", "lo"]);
    expect(out.every((o) => !("features" in o))).toBe(true);
  });
});

describe("IND-08 projectMatchConvergence (evaluation log — Precision@K/AUC/separation)", () => {
  it("no events → n_events=0, auc/precision/separation null, converged=false", async () => {
    const { env, bucket } = ctx();
    void env;
    const report = await projectMatchConvergence(new TruthStore(bucket), DEV_ACTOR);
    expect(report.n_events).toBe(0);
    expect(report.auc).toBeNull();
    expect(report.precision_at_k.value).toBeNull();
    expect(report.score_separation).toBeNull();
    expect(report.vector_change).toBe(0);
    expect(report.learning_stability_index).toBeNull();
    expect(report.converged).toBe(false);
  });

  it("perfectly separable labels → AUC=1, precision@k=1, converged=true", async () => {
    const { env, bucket } = ctx();
    // 2 positives with a large first feature, 2 negatives with a large second
    // feature; the learned weight favors feature 0 for positives.
    await pref(env, { item_id: "p1", kind: "swipe", y: 1, features: [1, 0] });
    await pref(env, { item_id: "p2", kind: "swipe", y: 1, features: [1, 0] });
    await pref(env, { item_id: "n1", kind: "pass", y: -1, features: [0, 1] });
    await pref(env, { item_id: "n2", kind: "pass", y: -1, features: [0, 1] });
    const report = await projectMatchConvergence(new TruthStore(bucket), DEV_ACTOR, 2);
    expect(report.n_events).toBe(4);
    expect(report.auc).toBe(1);
    expect(report.precision_at_k).toEqual({ k: 2, value: 1 });
    expect(report.score_separation).toBeGreaterThan(0);
    expect(report.converged).toBe(true);
  });

  it("vector_change reflects the LAST event's step magnitude (alpha*|y|*||x||)", async () => {
    const { env, bucket } = ctx();
    await pref(env, { item_id: "a", kind: "swipe", y: 1, features: [3, 4] }); // ||x||=5
    const report = await projectMatchConvergence(new TruthStore(bucket), DEV_ACTOR);
    expect(report.vector_change).toBeCloseTo(0.1 * 1 * 5, 10);
    expect(report.learning_stability_index).toBeNull(); // <2 events → undefined variance
  });

  it("GET /match/convergence route reachable + respects ?k=", async () => {
    const { env } = ctx();
    await pref(env, { item_id: "x", kind: "swipe", y: 1, features: [1] });
    const res = await app.request("/api/v1/match/convergence?k=1", { headers: AUTH }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { precision_at_k: { k: number } };
    expect(body.precision_at_k.k).toBe(1);
  });
});

describe("E4(uib02think §5-2①): GET /match/pair — 出題", () => {
  it("round=0 で個体マスタをID(ULID=作成時刻順)昇順に2件返す。features は含まない", async () => {
    const { env } = ctx();
    const a = await createInd(env, { species: "A" });
    const b = await createInd(env, { species: "B" });
    const sortedIds = [a, b].sort();
    const res = await app.request("/api/v1/match/pair", { headers: AUTH }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      round: number;
      target: number;
      exhausted: boolean;
      pair_id: string;
      left: { item_id: string };
      right: { item_id: string };
    };
    expect(body.round).toBe(0);
    expect(body.target).toBe(10);
    expect(body.exhausted).toBe(false);
    expect(body.left.item_id).toBe(sortedIds[0]);
    expect(body.right.item_id).toBe(sortedIds[1]);
    expect("features" in body.left).toBe(false);
    expect(typeof body.pair_id).toBe("string");
  });

  it("候補が2件未満(0/1件)なら exhausted:true", async () => {
    const { env } = ctx();
    const empty = (await (await app.request("/api/v1/match/pair", { headers: AUTH }, env)).json()) as { exhausted: boolean };
    expect(empty.exhausted).toBe(true);
    await createInd(env, { species: "solo" });
    const solo = (await (await app.request("/api/v1/match/pair", { headers: AUTH }, env)).json()) as { exhausted: boolean };
    expect(solo.exhausted).toBe(true);
  });

  it("回答済みラウンド数(distinct pair_id・V3-UIX-79)に応じて次のペアへ進む", async () => {
    const { env } = ctx();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push(await createInd(env, { species: `S${i}` }));
    const sorted = [...ids].sort();
    const first = (await (await app.request("/api/v1/match/pair", { headers: AUTH }, env)).json()) as {
      pair_id: string;
      left: { item_id: string };
      right: { item_id: string };
    };
    expect(await (await pairChoice(env, { pair_id: first.pair_id, left_item_id: first.left.item_id, right_item_id: first.right.item_id, choice: "left" })).status).toBe(201);
    const second = (await (await app.request("/api/v1/match/pair", { headers: AUTH }, env)).json()) as {
      round: number;
      left: { item_id: string };
      right: { item_id: string };
    };
    expect(second.round).toBe(1);
    expect(second.left.item_id).toBe(sorted[2]);
    expect(second.right.item_id).toBe(sorted[3]);
  });
});

describe("E4(uib02think §5-2②): POST /match/pair-choice — 記録", () => {
  it("left選択 → 左y=+1/右y=-1 の2件を同一pair_id・kind=pairwiseで記録する", async () => {
    const { env, bucket } = ctx();
    const a = await createInd(env, { species: "A" });
    const b = await createInd(env, { species: "B" });
    const res = await pairChoice(env, { pair_id: "r1", left_item_id: a, right_item_id: b, choice: "left" });
    expect(res.status).toBe(201);
    const s = new TruthStore(bucket);
    const rows = (await s.listEvents(`truth/ihl.match.preference.v1/${DEV_ACTOR}-`)).map(
      (e) => (e as { data: Record<string, unknown> }).data,
    );
    const pairwise = rows.filter((d) => d.kind === "pairwise");
    expect(pairwise).toHaveLength(2);
    const left = pairwise.find((d) => d.item_id === a)!;
    const right = pairwise.find((d) => d.item_id === b)!;
    expect(left.y).toBe(1);
    expect(right.y).toBe(-1);
    expect(left.pair_id).toBe("r1");
    expect(right.pair_id).toBe("r1");
    expect(left.features_version).toBe("tagvocab-v1");
  });

  it("neither選択 → 両方 y=0(G79-1裁定・neitherは候補から除外しない前提のスキーマ)", async () => {
    const { env, bucket } = ctx();
    const a = await createInd(env, { species: "A" });
    const b = await createInd(env, { species: "B" });
    expect((await pairChoice(env, { pair_id: "r2", left_item_id: a, right_item_id: b, choice: "neither" })).status).toBe(201);
    const s = new TruthStore(bucket);
    const rows = (await s.listEvents(`truth/ihl.match.preference.v1/${DEV_ACTOR}-`)).map(
      (e) => (e as { data: Record<string, unknown> }).data,
    );
    expect(rows.every((d) => d.y === 0)).toBe(true);
  });

  it("同一pair_idの二重送信は2件目が409(put-if-absentによる自然な冪等性)", async () => {
    const { env } = ctx();
    const a = await createInd(env, { species: "A" });
    const b = await createInd(env, { species: "B" });
    const first = await pairChoice(env, { pair_id: "dup1", left_item_id: a, right_item_id: b, choice: "left" });
    expect(first.status).toBe(201);
    const dup = await pairChoice(env, { pair_id: "dup1", left_item_id: a, right_item_id: b, choice: "left" });
    expect(dup.status).toBe(409);
  });

  it("choice が left/right/neither 以外、または pair_id/item_id 欠落は400", async () => {
    const { env } = ctx();
    const a = await createInd(env, { species: "A" });
    const b = await createInd(env, { species: "B" });
    expect((await pairChoice(env, { pair_id: "bad1", left_item_id: a, right_item_id: b, choice: "up" })).status).toBe(400);
    expect((await pairChoice(env, { left_item_id: a, right_item_id: b, choice: "left" })).status).toBe(400);
  });
});

describe("E4: computeMatchFeatures — features生成の決定論性(HQ裁定G79-1)", () => {
  it("同一入力(feature_tags+size)は常に同一ベクトルを返す", () => {
    const v1 = computeMatchFeatures(["色重視", "体格重視"], 62.4);
    const v2 = computeMatchFeatures(["色重視", "体格重視"], 62.4);
    expect(v1).toEqual(v2);
  });

  it("固定語彙のone-hot位置に1が立ち、語彙外タグは末尾の「その他」バケツへ写像される(情報を捨てない)", () => {
    const v = computeMatchFeatures(["色重視", "未知タグ"], null);
    expect(v[MATCH_FEATURE_TAG_VOCAB.indexOf("色重視")]).toBe(1);
    expect(v[MATCH_FEATURE_TAG_VOCAB.length]).toBe(1); // 「その他」バケツ
    expect(v[v.length - 1]).toBe(0); // サイズ無し
  });

  it("サイズは MATCH_FEATURE_SIZE_NORM_MM(=100)で正規化される", () => {
    const v = computeMatchFeatures([], 100);
    expect(v[v.length - 1]).toBeCloseTo(1, 10);
  });
});
