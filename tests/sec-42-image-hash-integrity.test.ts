// V3-SEC-42: 画像・解析データへの SHA-256 付与(改ざん検出・R2データ完全性・論文提出時の
// 真正性証明)。元画像の sha256 は既存実装済み(observation-routes.ts POST /observation/upload
// — 本ファイルの対象外)。本ファイルが固定するのは残り2件: (1) ROI マスク(アノテーション
// AST)の ast_sha256、(2) 解析結果 JSON の results_sha256。加えて「外部からの画像アップロード
// 経路(observation/image 以外)は作らず公式観測は kind:image.capture のみ」という構造制約を
// gov-no-automod.test.ts と同型の負の回帰テストで固定する。
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { canonicalJson, sha256Hex, TruthStore, ulid } from "@ihl/truth";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const AUTH_JSON = { Authorization: `Bearer ${DEV_TOKEN}`, "content-type": "application/json" };

function ctx() {
  const bucket = new FakeR2Bucket();
  return { bucket, env: makeEnv(bucket) };
}
async function post(path: string, body: unknown, env: object) {
  return app.request(path, { method: "POST", headers: AUTH_JSON, body: JSON.stringify(body) }, env);
}

describe("V3-SEC-42 annotation AST hash (ROI mask tamper detection)", () => {
  it("stores ast_sha256 = SHA-256(canonicalJson(ast))", async () => {
    const { bucket, env } = ctx();
    const captureId = ulid();
    const ast = { shapes: [{ label: "wing", points: [[1, 2]] }] };
    const res = await post("/api/v1/observation/annotations", { capture_id: captureId, ast }, env);
    expect(res.status).toBe(202);
    const { annotation_id } = (await res.json()) as { annotation_id: string };
    const stored = await new TruthStore(bucket).readEvent(`truth/ihl.obs.annotation.v1/${captureId}-${annotation_id}.json`);
    const data = stored!.data as { ast_sha256: string };
    expect(data.ast_sha256).toBe(await sha256Hex(canonicalJson(ast)));
    expect(data.ast_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a client-supplied ast_sha256 in the body is ignored (server always recomputes)", async () => {
    const { bucket, env } = ctx();
    const captureId = ulid();
    const ast = { a: 1 };
    const res = await post(
      "/api/v1/observation/annotations",
      { capture_id: captureId, ast, ast_sha256: "0".repeat(64) },
      env,
    );
    const { annotation_id } = (await res.json()) as { annotation_id: string };
    const stored = await new TruthStore(bucket).readEvent(`truth/ihl.obs.annotation.v1/${captureId}-${annotation_id}.json`);
    const data = stored!.data as { ast_sha256: string };
    expect(data.ast_sha256).toBe(await sha256Hex(canonicalJson(ast)));
    expect(data.ast_sha256).not.toBe("0".repeat(64));
  });
});

describe("V3-SEC-42 analysis results hash (再解析結果の改ざん検出)", () => {
  it("stores results_sha256 = SHA-256(canonicalJson(results))", async () => {
    const { bucket, env } = ctx();
    const captureId = ulid();
    const results = { length_mm: 42.5, weight_g: 3.2 };
    const res = await post(
      `/api/v1/observation/${captureId}/reanalyze`,
      { results, correction_semver: "1.0.0" },
      env,
    );
    expect(res.status).toBe(202);
    const { analysis_id } = (await res.json()) as { analysis_id: string };
    const stored = await new TruthStore(bucket).readEvent(`truth/ihl.obs.analysis.v1/${captureId}-${analysis_id}.json`);
    const data = stored!.data as { results_sha256: string };
    expect(data.results_sha256).toBe(await sha256Hex(canonicalJson(results)));
  });

  it("different results produce different hashes (tamper/divergence detectable)", async () => {
    const { bucket, env } = ctx();
    const captureId = ulid();
    const r1 = (await post(`/api/v1/observation/${captureId}/reanalyze`, { results: { a: 1 }, correction_semver: "1.0.0" }, env).then((r) => r.json())) as { analysis_id: string };
    const r2 = (await post(`/api/v1/observation/${captureId}/reanalyze`, { results: { a: 2 }, correction_semver: "1.0.1" }, env).then((r) => r.json())) as { analysis_id: string };
    const s = new TruthStore(bucket);
    const d1 = (await s.readEvent(`truth/ihl.obs.analysis.v1/${captureId}-${r1.analysis_id}.json`))!.data as { results_sha256: string };
    const d2 = (await s.readEvent(`truth/ihl.obs.analysis.v1/${captureId}-${r2.analysis_id}.json`))!.data as { results_sha256: string };
    expect(d1.results_sha256).not.toBe(d2.results_sha256);
  });
});

describe("V3-SEC-42 single official image ingest path (negative regression)", () => {
  const SRC_DIR = fileURLToPath(new URL("../apps/api/src/", import.meta.url));
  const sources = readdirSync(SRC_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => ({ file: f, text: readFileSync(SRC_DIR + f, "utf8") }));

  it("only observation-routes.ts stores a media/photo blob via formData()+putBlob", () => {
    const offenders = sources
      .filter((s) => /formData\(\)/.test(s.text) && /putBlob\(/.test(s.text))
      .map((s) => s.file);
    expect(offenders).toEqual(["observation-routes.ts"]);
  });

  it("no other route registers a raw image-upload endpoint outside /observation/upload", () => {
    const uploadRouteRe = /\.post\(\s*["'`][^"'`]*upload[^"'`]*["'`]/gi;
    const offenders = sources
      .filter((s) => s.file !== "observation-routes.ts" && uploadRouteRe.test(s.text))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });
});
