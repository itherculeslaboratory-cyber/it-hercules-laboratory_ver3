// V3-SEC-45(部分実装): Fork/Workflow/Component 実行要求の事前検証ゲート(Whitelist+
// Permission制御)。実際の隔離実行ランタイムは未実装(docs/planning/c8/
// design-v3-sec-45-sandbox-boundary.md参照・誇張ゼロ)。本ファイルは「失敗時は400を返す」
// (srs.md 検証キー)を全4条件について固定する。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { SANDBOX_CPU_MS_MAX, SANDBOX_MEMORY_MB_MAX } from "../apps/api/src/sandbox-routes";
import { AUTH_HEADERS, makeEnv } from "./helpers";

function post(body: unknown) {
  return app.request("/api/v1/sandbox/execute-request", { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(body) }, makeEnv());
}

describe("V3-SEC-45 sandbox execute-request gate (400 on every violation)", () => {
  it("unwhitelisted ref -> 400 WHITELIST_VIOLATION", async () => {
    const res = await post({ kind: "component", ref: "not-a-real-component" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("WHITELIST_VIOLATION");
  });

  it("invalid kind -> 400 INVALID_REQUEST", async () => {
    const res = await post({ kind: "shell-script", ref: "x" });
    expect(res.status).toBe(400);
  });

  it("write against production DB -> 400 PRODUCTION_WRITE_FORBIDDEN", async () => {
    const res = await post({ kind: "workflow", ref: "batch-commit", target_db: "production", write: true });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("PRODUCTION_WRITE_FORBIDDEN");
  });

  it("read-only against production DB is fine (production is read-only, not forbidden entirely)", async () => {
    const res = await post({ kind: "workflow", ref: "batch-commit", target_db: "production", write: false });
    expect(res.status).toBe(202);
  });

  it("write against test DB is allowed (test DB is destructible)", async () => {
    const res = await post({ kind: "workflow", ref: "batch-commit", target_db: "test", write: true });
    expect(res.status).toBe(202);
  });

  it("network access requested -> 400 NETWORK_ACCESS_FORBIDDEN", async () => {
    const res = await post({ kind: "api", ref: "match-preference", network: true });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("NETWORK_ACCESS_FORBIDDEN");
  });

  it("CPU over cap -> 400 RESOURCE_LIMIT_EXCEEDED", async () => {
    const res = await post({ kind: "api", ref: "match-preference", cpu_ms: SANDBOX_CPU_MS_MAX + 1 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("RESOURCE_LIMIT_EXCEEDED");
  });

  it("memory over cap -> 400 RESOURCE_LIMIT_EXCEEDED", async () => {
    const res = await post({ kind: "api", ref: "match-preference", memory_mb: SANDBOX_MEMORY_MB_MAX + 1 });
    expect(res.status).toBe(400);
  });

  it("a fully compliant request -> 202 accepted (authorization only, not execution)", async () => {
    const res = await post({ kind: "api", ref: "match-preference", target_db: "test", write: true, network: false, cpu_ms: 100, memory_mb: 16 });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ accepted: true });
  });

  it("unauthenticated -> 401 (deny-by-default)", async () => {
    const res = await app.request("/api/v1/sandbox/execute-request", { method: "POST", body: JSON.stringify({}) }, makeEnv());
    expect(res.status).toBe(401);
  });
});
