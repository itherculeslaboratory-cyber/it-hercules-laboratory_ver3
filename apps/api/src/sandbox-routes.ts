// V3-SEC-45(部分実装・誇張ゼロ — 詳細は docs/planning/c8/design-v3-sec-45-sandbox-boundary.md)。
// Fork/Workflow/Component 実行"要求"の事前検証ゲート(Whitelist+Permission制御)のみを
// 実装する。実際の隔離実行ランタイム(Extism/Docker/WebAssembly/vm)は Cloudflare Workers
// ランタイム(workerd)が動的コード生成を禁止するため本ファイルには含まれない(design doc
// 参照)。このゲートは「通過したら実行してよい」という認可判定であり、実行そのものは
// 行わない — レスポンスは accepted:true のみで、成功=実行完了ではない。
import { Hono } from "hono";
import type { Bindings, Variables } from "./env";

export const sandboxRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Whitelist(Component/API/Workflow)。プレースホルダ — 実際の registry 確定時に置換する
// (design doc §引継ぎ1)。ponytail: 固定配列。GUI 管理は後波(V3-GOV-17 系と同型の較正棚)。
export const SANDBOX_WHITELIST: Record<"component" | "api" | "workflow", ReadonlySet<string>> = {
  component: new Set(["obs-card", "market-listing-card", "plaza-post-card"]),
  api: new Set(["match-preference", "plaza-signal", "market-listing"]),
  workflow: new Set(["batch-commit", "reanalyze"]),
};

// CPU/メモリ上限(宣言値の検証のみ・実測強制はしない=design doc 参照)。
// ponytail: 較正 knob。実行基盤導入時に運用実測で調整。
export const SANDBOX_CPU_MS_MAX = 5000;
export const SANDBOX_MEMORY_MB_MAX = 256;

interface ExecuteRequestBody {
  kind?: unknown;
  ref?: unknown;
  target_db?: unknown;
  write?: unknown;
  network?: unknown;
  cpu_ms?: unknown;
  memory_mb?: unknown;
}

// POST /sandbox/execute-request — 実行要求の事前検証(認可ゲートのみ・実行はしない)。
sandboxRoutes.post("/sandbox/execute-request", async (c) => {
  const body = (await c.req.json().catch(() => null)) as ExecuteRequestBody | null;
  if (!body) return c.json({ error: "INVALID_REQUEST" }, 400);

  const kind = body.kind;
  if (kind !== "component" && kind !== "api" && kind !== "workflow") {
    return c.json({ error: "INVALID_REQUEST", details: ["kind must be component|api|workflow"] }, 400);
  }
  const ref = typeof body.ref === "string" ? body.ref : "";
  if (!ref || !SANDBOX_WHITELIST[kind].has(ref)) {
    return c.json({ error: "WHITELIST_VIOLATION", details: [`${kind}:${ref} is not whitelisted`] }, 400);
  }

  const targetDb = body.target_db === "production" ? "production" : "test";
  const write = body.write === true;
  if (targetDb === "production" && write) {
    return c.json({ error: "PRODUCTION_WRITE_FORBIDDEN", details: ["production DB is read-only for sandboxed execution"] }, 400);
  }

  if (body.network === true) {
    return c.json({ error: "NETWORK_ACCESS_FORBIDDEN", details: ["sandboxed execution may not reach external networks"] }, 400);
  }

  const cpuMs = typeof body.cpu_ms === "number" ? body.cpu_ms : 0;
  const memoryMb = typeof body.memory_mb === "number" ? body.memory_mb : 0;
  if (cpuMs > SANDBOX_CPU_MS_MAX || memoryMb > SANDBOX_MEMORY_MB_MAX) {
    return c.json(
      { error: "RESOURCE_LIMIT_EXCEEDED", details: [`cpu_ms<=${SANDBOX_CPU_MS_MAX}`, `memory_mb<=${SANDBOX_MEMORY_MB_MAX}`] },
      400,
    );
  }

  // 認可のみ。実行基盤は未接続(design doc 参照) — accepted は「要求が拒否条件に
  // 当たらなかった」を意味するだけで、実行完了を意味しない。
  return c.json({ accepted: true, kind, ref, target_db: targetDb }, 202);
});
