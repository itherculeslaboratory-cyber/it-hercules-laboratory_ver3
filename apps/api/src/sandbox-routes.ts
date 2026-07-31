// V3-SEC-45(部分実装・誇張ゼロ — 詳細は docs/planning/c8/design-v3-sec-45-sandbox-boundary.md)。
// Fork/Workflow/Component 実行"要求"の事前検証ゲート(Whitelist+Permission制御)のみを
// 実装する。実際の隔離実行ランタイム(Extism/Docker/WebAssembly/vm)は Cloudflare Workers
// ランタイム(workerd)が動的コード生成を禁止するため本ファイルには含まれない(design doc
// 参照)。このゲートは「通過したら実行してよい」という認可判定であり、実行そのものは
// 行わない — レスポンスは accepted:true のみで、成功=実行完了ではない。
//
// ★所有(2026-08-01・design19 §T1-9・発注書 sec2): このファイルは w1-sec が所有する
// (未帰属11ファイルの1つを解消)。FND-31(Personal Sandbox Realm・本番設定のfork/diff/
// Promote基盤)は名前が似ているだけの別物で、新規ファイル(w1-fnd 所有)に実装される —
// このファイルには1行も入らない(design19 §T1-9)。
//
// ★T2是正(2026-07-31 g64-design19 §T2・R64-9でユーザー案=利用者ローカルDockerを採用):
// 「安全な隔離実行」はこちら側では提供しない設計へ確定した。ロジックはこの是正の前後で
// 変わらない(このゲートは元々実行しない)。応答文言だけを「安全です」と誤読されない形へ
// 修正する — 未実装を誤魔化す表示ではなく、そういう設計だという積極的な宣言。
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

// T2是正(design19 §T2)の応答文言。400/202 の全応答に明記する(ロジック変更なし・
// 「安全です」と誤読されないための表示のみの修正)。
export const SANDBOX_LOCAL_EXECUTION_NOTE = "隔離実行はこちらでは行わない。ローカルで実行してください。";

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
  if (!body) return c.json({ error: "INVALID_REQUEST", note: SANDBOX_LOCAL_EXECUTION_NOTE }, 400);

  const kind = body.kind;
  if (kind !== "component" && kind !== "api" && kind !== "workflow") {
    return c.json(
      { error: "INVALID_REQUEST", details: ["kind must be component|api|workflow"], note: SANDBOX_LOCAL_EXECUTION_NOTE },
      400,
    );
  }
  const ref = typeof body.ref === "string" ? body.ref : "";
  if (!ref || !SANDBOX_WHITELIST[kind].has(ref)) {
    return c.json(
      { error: "WHITELIST_VIOLATION", details: [`${kind}:${ref} is not whitelisted`], note: SANDBOX_LOCAL_EXECUTION_NOTE },
      400,
    );
  }

  const targetDb = body.target_db === "production" ? "production" : "test";
  const write = body.write === true;
  if (targetDb === "production" && write) {
    return c.json(
      { error: "PRODUCTION_WRITE_FORBIDDEN", details: ["production DB is read-only for sandboxed execution"], note: SANDBOX_LOCAL_EXECUTION_NOTE },
      400,
    );
  }

  if (body.network === true) {
    return c.json(
      { error: "NETWORK_ACCESS_FORBIDDEN", details: ["sandboxed execution may not reach external networks"], note: SANDBOX_LOCAL_EXECUTION_NOTE },
      400,
    );
  }

  const cpuMs = typeof body.cpu_ms === "number" ? body.cpu_ms : 0;
  const memoryMb = typeof body.memory_mb === "number" ? body.memory_mb : 0;
  if (cpuMs > SANDBOX_CPU_MS_MAX || memoryMb > SANDBOX_MEMORY_MB_MAX) {
    return c.json(
      {
        error: "RESOURCE_LIMIT_EXCEEDED",
        details: [`cpu_ms<=${SANDBOX_CPU_MS_MAX}`, `memory_mb<=${SANDBOX_MEMORY_MB_MAX}`],
        note: SANDBOX_LOCAL_EXECUTION_NOTE,
      },
      400,
    );
  }

  // 認可のみ。実行基盤は未接続(design doc 参照) — accepted は「要求が拒否条件に
  // 当たらなかった」を意味するだけで、実行完了を意味しない。
  // note(2026-08-01 T2是正): 隔離実行そのものはこちらでは行わない設計に確定した
  // (利用者ローカルDocker案・design19 §T2)。「安全に実行できる」と誤読されないよう
  // 明記する。
  return c.json(
    { accepted: true, kind, ref, target_db: targetDb, note: SANDBOX_LOCAL_EXECUTION_NOTE },
    202,
  );
});
