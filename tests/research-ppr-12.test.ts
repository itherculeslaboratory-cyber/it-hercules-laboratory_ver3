// V3-PPR-12 — 完全ローカル計算(端末CPU/GPU・SIMD/LUT/ROI Lab変換)でサーバ負荷ゼロ。
// 実解析は端末側で完結する設計のため、サーバ側は(a) 既存 batch-commit を kind:"reanalyze"
// で拡張した Recompute All 保存経路(結果の append+diff記録のみ)と (b) 全データCSV
// ダウンロードのみを提供する(重処理を追加しない・不変条項①)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { ulid } from "@ihl/truth";
import { capturesToCsv } from "../apps/api/src/observation-routes";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

function post(env: ReturnType<typeof makeEnv>, path: string, body: unknown) {
  return app.request(`/api/v1${path}`, { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(body) }, env);
}

describe("capturesToCsv", () => {
  it("flattens measurements into one CSV row per measurement, RFC4180-escaping commas", () => {
    const csv = capturesToCsv([
      { capture_id: "C1", subject_ref: "individual/I1", domain: "biology", measurements: [{ item: "horn, length", value: 80, unit: "mm" }] },
    ]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("capture_id,subject_ref,domain,item,value,unit,value_origin,observed_at");
    expect(lines[1]).toBe('C1,individual/I1,biology,"horn, length",80,mm,,');
  });

  it("returns just the header (plus trailing newline) with zero captures", () => {
    expect(capturesToCsv([])).toBe("capture_id,subject_ref,domain,item,value,unit,value_origin,observed_at\n");
  });
});

describe("POST /api/v1/observation/batch-commit kind:reanalyze (Recompute All)", () => {
  it("appends a NEW analysis per item without overwriting prior analyses", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const captureId = ulid();
    const cap = await post(env, "/observation/captures", { domain: "biology", capture_id: captureId });
    expect(cap.status).toBe(202);

    const res = await post(env, "/observation/batch-commit", {
      items: [
        { kind: "reanalyze", capture_id: captureId, body: { results: { size: 81 }, correction_semver: "1.0.1" } },
        { kind: "reanalyze", capture_id: captureId, body: { results: { size: 82 }, correction_semver: "1.0.2", delta: { size: 1 } } },
      ],
    });
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as { results: { ok: boolean; id?: string }[] };
    expect(results.every((r) => r.ok)).toBe(true);
    expect(new Set(results.map((r) => r.id)).size).toBe(2); // both kept (append-only, no overwrite)

    const manifest = await app.request(`/api/v1/observation/${captureId}/reanalysis-manifest`, { headers: AUTH_HEADERS }, env);
    const body = (await manifest.json()) as { count: number };
    expect(body.count).toBe(2);
  });

  it("reports a partial per-item failure honestly (missing capture_id)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const res = await post(env, "/observation/batch-commit", {
      items: [{ kind: "reanalyze", body: { results: { size: 1 }, correction_semver: "1.0" } }],
    });
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as { results: { ok: boolean; error?: string }[] };
    expect(results[0]).toEqual({ ok: false, error: "INVALID_ITEM" });
  });

  it("accepts up to BATCH_MAX_ITEMS(1000) items — Recompute All 1000枚一括", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const items = Array.from({ length: 1000 }, () => ({ kind: "capture", body: { domain: "biology" } }));
    const res = await post(env, "/observation/batch-commit", { items });
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as { results: unknown[] };
    expect(results).toHaveLength(1000);
  });
});

describe("GET /api/v1/observation/export", () => {
  it("returns a CSV attachment of all capture measurements", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const captureId = ulid();
    const created = await post(env, "/observation/captures", {
      domain: "biology", capture_id: captureId,
      measurements: [{ item: "weight", kind: "number", value: 30, unit: "g" }],
    });
    expect(created.status).toBe(202);
    const res = await app.request("/api/v1/observation/export", { headers: AUTH_HEADERS }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const csv = await res.text();
    expect(csv).toContain(`${captureId},,biology,weight,30,g,,`);
  });

  it("requires auth (401)", async () => {
    const res = await app.request("/api/v1/observation/export", {}, makeEnv());
    expect(res.status).toBe(401);
  });
});
