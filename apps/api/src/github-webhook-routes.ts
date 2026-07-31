// KRM-13 GitHub webhook（design-k3 §2.2/§2.5）。session 層 public + HMAC self-gate
// （collector/ingest と同型・署名がクレデンシャル）。X-Hub-Signature-256 を hmac.ts で
// 検証し、X-GitHub-Delivery を Truth キーに put-if-absent（重複 delivery=409 べき等）。
// 行動→pt+axis+badge 換算は config/github-contribution-weights.json を policy 経由で
// ロード（ハードコード禁止）。貢献は ihl.economy.contribution_event.v1 に append。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { verifyHmacSha256 } from "./hmac";
// 換算表は config 正本（生成物でない）。JSON は esbuild/vitest ネイティブ loader で bundle。
import weightsConfig from "../../../config/github-contribution-weights.json";

const CONTRIBUTION_TYPE = "ihl.economy.contribution_event.v1";
const CONTRIBUTION_SCHEMA = "schemas/events/economy-contribution-event.schema.json";
const SCHEMA_VERSION = "1";

// V3-AUT-38(bridgeplan §J1-6・確定設計)。github_login ↔ IHL actor_id の対応表。
const LINK_TYPE = "ihl.aut.github_link.v1";
const LINK_SCHEMA = "schemas/events/aut-github-link.schema.json";
const LINK_SCHEMA_VERSION = "1";
// mapping未設定の github_login からの貢献は全員この1プールへ寄せる(loginごとに
// 別アクター=プールが分裂する現行不具合の是正)。連携前の貢献はこのプールへ入り、
// 事後に個人へ遡及移管する機構は無い(連携前の貢献は遡及できない・要件どおり)。
const GITHUB_ANONYMOUS_ACTOR = "github:anonymous";

type Weight = { pt: number; axis: string };
type Badge = { trigger: string; count: number };
const WEIGHTS = (weightsConfig as { weights: Record<string, Weight> }).weights;
const BADGES = (weightsConfig as { badges?: Record<string, Badge> }).badges ?? {};

// X-GitHub-Event ヘッダ → 換算表キー。GitHub のイベント名と weights キーのゆらぎを吸収。
const EVENT_ALIAS: Record<string, string> = {
  pull_request: "pull_request",
  issues: "issue",
  pull_request_review: "review",
  issue_comment: "comment",
  commit_comment: "comment",
  pull_request_review_comment: "comment",
  push: "push",
  release: "release",
  watch: "star",
  star: "star",
};

/** X-GitHub-Event → 換算 weight（policy 経由・未登録イベントは null=無視）。 */
export function weightForEvent(githubEvent: string): (Weight & { key: string }) | null {
  const key = EVENT_ALIAS[githubEvent];
  if (!key || !WEIGHTS[key]) return null;
  return { key, ...WEIGHTS[key] };
}

/** この weight キーが加算対象の badge 名一覧（trigger 一致・進捗表示用）。 */
export function badgesForKey(key: string): string[] {
  return Object.entries(BADGES).filter(([, b]) => b.trigger === key).map(([name]) => name);
}

export const githubWebhookRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// github_login → 対応付け済み actor_id を返す(未連携は undefined)。login prefix scan
// (Truth キー truth/ihl.aut.github_link.v1/<github_login>/<link_id>.json)。同一 login に
// 複数行あっても最新(created_at 降順)を採用(付け替え=再連携を許容)。
export async function resolveGithubActor(s: TruthStore, githubLogin: string): Promise<string | undefined> {
  const rows = (await s.listEvents(`truth/${LINK_TYPE}/${githubLogin}/`)).map((e) => (e.data ?? {}) as Record<string, unknown>);
  if (rows.length === 0) return undefined;
  rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return typeof rows[0].actor_id === "string" ? rows[0].actor_id : undefined;
}

// POST /auth/github/link — GitHub アカウントと IHL actor_id の紐付けを確定(V3-AUT-38・
// bridgeplan §J1-6)。github-webhook-routes.ts と同居(w1-mktのglobはgithub*を含むが
// w1-autのglobは含まないため)。PROTECTED(index.ts §1.5 gate・PUBLIC_ROUTES非登録)・
// linked_by はセッション principal 強制(V3-AUT-17)。本人が自分の actor_id へ連携する
// (代理連携は想定しない・linked_by=actorId自身)。
githubWebhookRoutes.post("/auth/github/link", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const githubLogin = body && typeof body.github_login === "string" ? body.github_login.trim() : "";
  if (!githubLogin) return c.json({ error: "INVALID_LINK", details: ["github_login required"] }, 400);

  const actorId = c.get("actorId");
  const linkId = ulid();
  const data: Record<string, unknown> = {
    link_id: linkId,
    github_login: githubLogin,
    actor_id: actorId,
    linked_by: actorId,
    created_at: new Date().toISOString(),
    schema_version: LINK_SCHEMA_VERSION,
  };
  const res = await new TruthStore(c.env.TRUTH).putEventAt(`truth/${LINK_TYPE}/${githubLogin}/${linkId}.json`, {
    specversion: "1.0",
    id: ulid(),
    source: "apps/api",
    type: LINK_TYPE,
    time: new Date().toISOString(),
    dataschema: LINK_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  });
  if (res.status === "invalid") return c.json({ error: "INVALID_LINK", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_LINK", key: res.key }, 409);
  return c.json({ link_id: linkId, github_login: githubLogin, actor_id: actorId }, 201);
});

// POST /github/webhook — HMAC 検証 → 換算 → contribution_event を delivery_id キーで
// put-if-absent。署名 IS credential（forged/欠如 → 401・何も保存しない）。
githubWebhookRoutes.post("/github/webhook", async (c) => {
  const raw = await c.req.text();
  const secret = (c.env as { GITHUB_WEBHOOK_SECRET?: string }).GITHUB_WEBHOOK_SECRET ?? "";
  const sig = c.req.header("X-Hub-Signature-256");
  if (!(await verifyHmacSha256(raw, sig, secret))) {
    return c.json({ error: "SIGNATURE_INVALID" }, 401);
  }

  const delivery = c.req.header("X-GitHub-Delivery");
  if (!delivery) return c.json({ error: "MISSING_DELIVERY" }, 400);

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return c.json({ error: "INVALID_PAYLOAD" }, 400);
  }

  const githubEvent = c.req.header("X-GitHub-Event") ?? "";
  const weight = weightForEvent(githubEvent);
  if (!weight) return c.json({ ok: true, ignored: true, event: githubEvent }, 200); // ping/未換算

  const sender = (payload.sender as { login?: unknown } | undefined)?.login;
  const githubLogin = typeof sender === "string" && sender ? sender : "";
  const repo = (payload.repository as { full_name?: unknown } | undefined)?.full_name;
  const nodeId = typeof repo === "string" && repo ? repo : "unknown-repo";

  // V3-AUT-38是正: 旧実装は login ごとに `github:${login}` という別アクターを作っており
  // loginの数だけプールが分裂していた(要件は「プール」を求めている)。連携済みなら
  // POST /auth/github/link で確定した actor_id へ計上し、未連携は全員 GITHUB_ANONYMOUS_ACTOR
  // へ寄せる。連携前の貢献は遡及できない(後から連携しても過去分は個人へ移らない)。
  const truthStore = new TruthStore(c.env.TRUTH);
  const linkedActor = githubLogin ? await resolveGithubActor(truthStore, githubLogin) : undefined;
  const actorId = linkedActor ?? GITHUB_ANONYMOUS_ACTOR;

  const contributionEventId = `gh-${delivery}`;
  const key = `truth/${CONTRIBUTION_TYPE}/${contributionEventId}.json`;
  const res = await truthStore.putEventAt(key, {
    specversion: "1.0",
    id: ulid(),
    source: "apps/api",
    type: CONTRIBUTION_TYPE,
    time: new Date().toISOString(),
    dataschema: CONTRIBUTION_SCHEMA,
    provenance: { generator_kind: "device", actor_id: actorId, device_id: "github" },
    data: {
      contribution_event_id: contributionEventId,
      node_id: nodeId,
      actor_id: actorId,
      axis: weight.axis,
      delta: weight.pt,
      source: "github",
      source_ref: delivery,
      created_at: new Date().toISOString(),
      schema_version: SCHEMA_VERSION,
    },
  });
  if (res.status === "invalid") return c.json({ error: "INVALID_CONTRIBUTION", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_DELIVERY", key: res.key }, 409); // 再送べき等
  return c.json(
    { contribution_event_id: contributionEventId, actor_id: actorId, axis: weight.axis, pt: weight.pt, badges_progressed: badgesForKey(weight.key) },
    201,
  );
});
