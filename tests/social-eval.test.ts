// KRM-20 社会評価 TC（design-k3 §4）。layer0-3 のみ集計・layer4 除外・本人自己評価
// （rater===author）除外・公式ランキング配列は生成しない（統計=counts のみ）。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, deriveActorId } from "@ihl/truth";
import { projectSocialEval } from "../apps/api/src/social-routes";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

const DEV_ACTOR = await deriveActorId("dev@ihl.local");
const EVAL_TYPE = "ihl.social.eval.v1";

// 生イベントを直接 seed（schema max=3 を跨ぐ layer4 も投影フィルタ検証のため注入）。
let seq = 0;
function seedEval(
  bucket: FakeR2Bucket,
  d: { node: string; layer: number; rater: string; kind: string },
): void {
  seq += 1;
  const id = `E${seq}`;
  const env = {
    specversion: "1.0", id, source: "apps/api", type: EVAL_TYPE,
    time: "2026-07-11T00:00:00Z", dataschema: "schemas/events/social-eval.schema.json",
    provenance: { generator_kind: "human", actor_id: d.rater },
    data: {
      eval_id: id, target_node_id: d.node, target_layer: d.layer, rater_id: d.rater,
      kind: d.kind, created_at: "2026-07-11T00:00:00Z", schema_version: "1",
    },
  };
  bucket.objects.set(`truth/${EVAL_TYPE}/${id}.json`, { body: JSON.stringify(env), etag: `e${seq}` });
}

describe("KRM-20 projectSocialEval（統計のみ）", () => {
  it("kind 別に集計し counts を返す（ranking 配列は生成しない）", async () => {
    const bucket = new FakeR2Bucket();
    seedEval(bucket, { node: "N1", layer: 0, rater: "u1", kind: "like" });
    seedEval(bucket, { node: "N1", layer: 1, rater: "u2", kind: "like" });
    seedEval(bucket, { node: "N1", layer: 2, rater: "u3", kind: "vote" });
    const r = await projectSocialEval(new TruthStore(bucket), "N1");
    expect(r.counts).toMatchObject({ like: 2, vote: 1, dislike: 0 });
    expect(Object.keys(r)).toEqual(["node_id", "counts"]); // ranking 配列なし
    expect((r as Record<string, unknown>).ranking).toBeUndefined();
  });

  it("layer4 は除外（layer0-3 のみ集計）", async () => {
    const bucket = new FakeR2Bucket();
    seedEval(bucket, { node: "N2", layer: 3, rater: "u1", kind: "favorite" });
    seedEval(bucket, { node: "N2", layer: 4, rater: "u2", kind: "favorite" }); // 除外
    const r = await projectSocialEval(new TruthStore(bucket), "N2");
    expect(r.counts.favorite).toBe(1);
  });

  it("本人自己評価（rater===author）は集計前に除外", async () => {
    const bucket = new FakeR2Bucket();
    seedEval(bucket, { node: "N3", layer: 0, rater: "author-x", kind: "like" }); // 自己評価
    seedEval(bucket, { node: "N3", layer: 0, rater: "other", kind: "like" });
    const withAuthor = await projectSocialEval(new TruthStore(bucket), "N3", "author-x");
    expect(withAuthor.counts.like).toBe(1); // 自己評価が落ちる
    const noAuthor = await projectSocialEval(new TruthStore(bucket), "N3");
    expect(noAuthor.counts.like).toBe(2); // author 未指定なら除外しない
  });

  it("他ノード宛の評価は載らない", async () => {
    const bucket = new FakeR2Bucket();
    seedEval(bucket, { node: "A", layer: 0, rater: "u1", kind: "like" });
    seedEval(bucket, { node: "B", layer: 0, rater: "u1", kind: "like" });
    expect((await projectSocialEval(new TruthStore(bucket), "A")).counts.like).toBe(1);
  });
});

describe("POST /api/v1/social/eval", () => {
  it("認証なしは 401", async () => {
    const res = await app.request("/api/v1/social/eval", { method: "POST" }, makeEnv());
    expect(res.status).toBe(401);
  });

  it("target_layer>3 は 400", async () => {
    const res = await app.request(
      "/api/v1/social/eval",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ target_node_id: "N1", target_layer: 4, kind: "like" }) },
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("有効な評価は 201・rater_id はセッション principal", async () => {
    const bucket = new FakeR2Bucket();
    const res = await app.request(
      "/api/v1/social/eval",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ target_node_id: "N1", target_layer: 2, kind: "vote" }) },
      makeEnv(bucket),
    );
    expect(res.status).toBe(201);
    const ev = [...bucket.objects.values()][0];
    expect(JSON.parse(ev.body as string).data.rater_id).toBe(DEV_ACTOR);
  });
});

describe("GET /api/v1/components/{node_id}/eval", () => {
  it("counts を返す（公式ランキング非生成）", async () => {
    const bucket = new FakeR2Bucket();
    await app.request(
      "/api/v1/social/eval",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ target_node_id: "NX", target_layer: 0, kind: "follow" }) },
      makeEnv(bucket),
    );
    const res = await app.request("/api/v1/components/NX/eval", { headers: AUTH_HEADERS }, makeEnv(bucket));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { node_id: string; counts: { follow: number }; ranking?: unknown };
    expect(body).toMatchObject({ node_id: "NX", counts: { follow: 1 } });
    expect(body.ranking).toBeUndefined();
  });
});
