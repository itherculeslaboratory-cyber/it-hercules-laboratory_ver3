// F2(design R0801-c618a6-REPORT-2026-08-01-g78-b3think.md §4-2 案C) — manifest配信
// ルート(research-manifest-routes.ts)の検証。SQL実行はブラウザ側(duckdb-wasm)なので
// ここでは「generation情報を正しく返す」「未生成時は正直にnullを返す」「parquetバイト列
// をそのまま配信する」の3点のみを検証する(サーバ側にクエリ判断は一切無い)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";
import { RESEARCH_MANIFEST_PREFIX } from "../apps/api/src/research-manifest-routes";

describe("GET /api/v1/research/manifest/latest", () => {
  it("未認証は401", async () => {
    const env = makeEnv();
    const res = await app.request("/api/v1/research/manifest/latest", { method: "GET" }, env);
    expect(res.status).toBe(401);
  });

  it("manifest未生成(R2にlatest.jsonが無い)環境ではgeneration:nullを正直に返す", async () => {
    const env = makeEnv();
    const res = await app.request(
      "/api/v1/research/manifest/latest",
      { method: "GET", headers: AUTH_HEADERS },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { generation: number | null; generated_at: string | null };
    expect(body.generation).toBeNull();
    expect(body.generated_at).toBeNull();
  });

  it("latest.jsonがある場合はgeneration番号と生成時刻を返す", async () => {
    const bucket = new FakeR2Bucket();
    await bucket.put(
      `${RESEARCH_MANIFEST_PREFIX}/latest.json`,
      JSON.stringify({ generation: 3, generated_at: "2026-08-01T00:00:00+09:00" }),
    );
    const env = makeEnv(bucket);
    const res = await app.request(
      "/api/v1/research/manifest/latest",
      { method: "GET", headers: AUTH_HEADERS },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { generation: number | null; generated_at: string | null };
    expect(body.generation).toBe(3);
    expect(body.generated_at).toBe("2026-08-01T00:00:00+09:00");
  });
});

describe("GET /api/v1/research/manifest/generation/:gen/data.parquet", () => {
  it("未認証は401", async () => {
    const env = makeEnv();
    const res = await app.request(
      "/api/v1/research/manifest/generation/1/data.parquet",
      { method: "GET" },
      env,
    );
    expect(res.status).toBe(401);
  });

  it("存在しないgenerationは404(MANIFEST_NOT_FOUND)", async () => {
    const env = makeEnv();
    const res = await app.request(
      "/api/v1/research/manifest/generation/99/data.parquet",
      { method: "GET", headers: AUTH_HEADERS },
      env,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("MANIFEST_NOT_FOUND");
  });

  it("不正なgeneration(非数値)は400(INVALID_GENERATION)", async () => {
    const env = makeEnv();
    const res = await app.request(
      "/api/v1/research/manifest/generation/not-a-number/data.parquet",
      { method: "GET", headers: AUTH_HEADERS },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("存在するgenerationはparquetバイト列をそのまま返す", async () => {
    const bucket = new FakeR2Bucket();
    const fakeParquetBytes = new Uint8Array([0x50, 0x41, 0x52, 0x31]); // "PAR1" magic (符号だけ)
    await bucket.put(`${RESEARCH_MANIFEST_PREFIX}/generation-1/manifest.parquet`, fakeParquetBytes);
    const env = makeEnv(bucket);
    const res = await app.request(
      "/api/v1/research/manifest/generation/1/data.parquet",
      { method: "GET", headers: AUTH_HEADERS },
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes]).toEqual([...fakeParquetBytes]);
  });
});
