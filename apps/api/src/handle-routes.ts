// @ID(handle)確定 route(V3-AUT-08 / docs/planning/c7/usecase-driven-design.md
// §auth-onboarding-locale)。3〜30文字・限定文字種([A-Za-z0-9_])・一意・不変
// (HANDLE_IMMUTABLE)。OS は自動生成せず本人の明示タップで確定する。一意性の権威的
// 担保は確定時の put-if-absent(CL-01 同型・storage 層強制)。handle 自体を Truth
// キーの一部にするので存在確認は O(1) get、常駐 handle→user index も全ユーザー scan
// も持たない(不変条項①)。本人の逆引き(GET /me/handle・「既に確定済みか」判定)だけは
// handle-claim 全件 prefix scan(1 actor 高々1件・MVP 量なら軽量)。
// ponytail: 同一 actor が異なる2つの候補を同時送信するレースは一意性チェックが
// finding→put の間に競合し得る(理論上どちらも別 handle で通る可能性)。実運用は
// クライアントが確定ボタンを1つしか出さないため実害は薄い。厳密な二重防止が要る
// 波が来たら actor_id をキーにした reservation を先に put-if-absent する二段式へ。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";

const HANDLE_TYPE = "ihl.aut.handle.v1";
const HANDLE_SCHEMA = "schemas/events/handle-claim.schema.json";
const SCHEMA_VERSION = "1";
const HANDLE_RE = /^[A-Za-z0-9_]{3,30}$/;

export const handleRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

/** 本人が既に handle を確定済みなら its handle、未確定なら null。 */
export async function findOwnHandle(s: TruthStore, actorId: string): Promise<string | null> {
  const events = (await s.listEvents(`truth/${HANDLE_TYPE}/`)).map(dataOf);
  const mine = events.find((d) => d.actor_id === actorId);
  return mine ? String(mine.handle) : null;
}

// GET /me/handle — 本人の確定済み handle(未確定なら null)。
handleRoutes.get("/me/handle", async (c) => {
  const handle = await findOwnHandle(store(c), c.get("actorId"));
  return c.json({ handle });
});

// POST /me/handle — 確定(一度きり・不変)。body { handle }。
handleRoutes.post("/me/handle", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { handle?: unknown } | null;
  const handle = typeof body?.handle === "string" ? body.handle : "";
  if (!HANDLE_RE.test(handle)) {
    return c.json({ error: "INVALID_HANDLE", details: ["3-30 chars, [A-Za-z0-9_] only"] }, 400);
  }
  const actorId = c.get("actorId");
  const s = store(c);
  // V3-AUT-08: 確定後変更拒否。本人が既に確定済みなら新規確定も拒否する。
  if (await findOwnHandle(s, actorId)) {
    return c.json({ error: "HANDLE_IMMUTABLE" }, 409);
  }
  const id = ulid();
  const data = {
    handle,
    actor_id: actorId,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  const key = `truth/${HANDLE_TYPE}/${handle}.json`;
  const res = await s.putEventAt(key, {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: HANDLE_TYPE,
    time: new Date().toISOString(),
    dataschema: HANDLE_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  });
  if (res.status === "invalid") return c.json({ error: "INVALID_HANDLE", details: res.errors }, 400);
  // 一意性の権威的担保: 同じ handle キーへの二重 put は 409(CL-01 同型)。
  if (res.status === "conflict") return c.json({ error: "HANDLE_TAKEN", key: res.key }, 409);
  return c.json({ handle }, 201);
});
