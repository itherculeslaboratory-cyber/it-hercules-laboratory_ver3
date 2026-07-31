// R65-6(g65-routegate・2026-07-31): observation-routes.ts の以下2 routeは
// captureVisibleTo を一度も呼んでいなかった(監査=R0731-1ff12e-AUDIT-2026-07-31-
// g65-publicroutes.md 実測)。route-012/013と同型のゲートを追加した回帰テスト。
//   - GET /observation/{capture_id}/reanalysis-manifest (observation-routes.ts:1306)
//   - GET /observation/{capture_id}/species-suggestions (observation-routes.ts:895)
//
// ★注記(判断が要った箇所・報告書へ転記): 発注書は「visibility=private のcaptureに
// 未ログインでアクセス→404」を求めているが、この2 routeはまだ実際にはPUBLIC_ROUTESの
// 判定が機能しておらず(index.tsのPUBLIC_ROUTES.includes(c.req.path)はパス完全一致の
// みでcapture_id等の動的セグメントにマッチしない — 別途記録した既知の別問題)、未ログイン
// リクエストはこのroute自体の可視性ゲートに到達する前に401 AUTH_REQUIREDで止まる
// (実機確認済み)。そのため本ファイルは「別のログイン済みactor(=本人ではない)」で
// アクセスして同じ captureVisibleTo(cap, actorId) コードパスを検証する形に代替した
// (undefined と非所有者actorIdはどちらも captureVisibleTo 内で false を返す分岐が同一
// ・pure関数側は既存 tests/obs-w-obs2-2026-08-01.test.ts で actorId=undefined のケース
// を検証済み)。ゲートをコメントアウトすると本テストが実際に赤くなることを確認済み(下記)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { ulid } from "@ihl/truth";
import { issueSessionToken } from "../apps/api/src/session";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

async function bearer(actorId: string) {
  return { Authorization: `Bearer ${await issueSessionToken(actorId, SESSION_SECRET)}`, "content-type": "application/json" };
}
function ctx() {
  const bucket = new FakeR2Bucket();
  return { bucket, env: makeEnv(bucket) };
}
async function post(path: string, body: unknown, env: object, headers: Record<string, string>) {
  return app.request(path, { method: "POST", headers, body: JSON.stringify(body) }, env);
}
async function get(path: string, env: object, headers: Record<string, string>) {
  return app.request(path, { headers }, env);
}
async function seedCapture(
  env: object,
  headers: Record<string, string>,
  spec: { id: string; visibility?: string; vec?: Float32Array },
  bucket: FakeR2Bucket,
) {
  const res = await post("/api/v1/observation/captures", { capture_id: spec.id, domain: "biology", visibility: spec.visibility }, env, headers);
  expect(res.status).toBe(202);
  if (spec.vec) {
    const file = `embeddings/bin/${spec.id}.bin`;
    await bucket.put(`embeddings/manifest/${spec.id}.json`, JSON.stringify({ capture_id: spec.id, embedding_dim: spec.vec.length, embedding_file: file, vector_offset: 0 }));
    await bucket.put(file, spec.vec);
  }
}

describe("R65-6 GET /observation/{capture_id}/reanalysis-manifest 可視性ゲート", () => {
  it("visibility=private の capture に他人(非所有者)がアクセス -> 404(存在ごと隠す)", async () => {
    const { bucket, env } = ctx();
    const ownerH = await bearer("owner-a");
    const otherH = await bearer("owner-b");
    const id = ulid();
    await seedCapture(env, ownerH, { id, visibility: "private" }, bucket);
    const res = await get(`/api/v1/observation/${id}/reanalysis-manifest`, env, otherH);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "NOT_FOUND" });
  });

  it("visibility=public の capture に他人(非所有者)がアクセス -> 200", async () => {
    const { bucket, env } = ctx();
    const ownerH = await bearer("owner-a");
    const otherH = await bearer("owner-b");
    const id = ulid();
    await seedCapture(env, ownerH, { id, visibility: "public" }, bucket);
    const res = await get(`/api/v1/observation/${id}/reanalysis-manifest`, env, otherH);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { capture_id: string; count: number };
    expect(body.capture_id).toBe(id);
    expect(body.count).toBe(0);
  });
});

describe("R65-6 GET /observation/{capture_id}/species-suggestions 可視性ゲート", () => {
  it("visibility=private の capture に他人(非所有者)がアクセス -> 404(存在ごと隠す)", async () => {
    const { bucket, env } = ctx();
    const ownerH = await bearer("owner-a");
    const otherH = await bearer("owner-b");
    const id = ulid();
    await seedCapture(env, ownerH, { id, visibility: "private", vec: new Float32Array(384) }, bucket);
    const res = await get(`/api/v1/observation/${id}/species-suggestions`, env, otherH);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "NOT_FOUND" });
  });

  it("visibility=public の capture に他人(非所有者)がアクセス -> 200", async () => {
    const { bucket, env } = ctx();
    const ownerH = await bearer("owner-a");
    const otherH = await bearer("owner-b");
    const id = ulid();
    await seedCapture(env, ownerH, { id, visibility: "public", vec: new Float32Array(384) }, bucket);
    const res = await get(`/api/v1/observation/${id}/species-suggestions`, env, otherH);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidates: unknown[] };
    expect(Array.isArray(body.candidates)).toBe(true);
  });
});
