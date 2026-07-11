// KRM-20 社会評価 + KRM-25 プラチナ投票（design-k3 §2.2/§2.3）。評価/投票は
// append-only（ihl.social.eval.v1 / ihl.social.platinum_vote.v1）、集計は投影で
// 都度再計算（常駐 DB 禁止・不変条項①）。書込 rater_id/voter_id はセッション
// principal 強制（V3-AUT-17）。全 route は index.ts §1.5 gate 経由 PROTECTED。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { resolvePolicyInt } from "./policy";
import { SOCIAL_EVAL_LAYER_MAX } from "./economy-constants";
import { projectLedger } from "./ledger-routes";

const EVAL_TYPE = "ihl.social.eval.v1";
const EVAL_SCHEMA = "schemas/events/social-eval.schema.json";
const VOTE_TYPE = "ihl.social.platinum_vote.v1";
const VOTE_SCHEMA = "schemas/events/social-platinum-vote.schema.json";
const SCHEMA_VERSION = "1";

const EVAL_KINDS = ["vote", "like", "dislike", "favorite", "follow", "fork", "proposal"] as const;
type EvalKind = (typeof EVAL_KINDS)[number];

// KRM-25 公式化ライン。GUI 可変（config/economy-policy.csv・後波）。resolvePolicyInt を
// 通し、行未供給時は既定 100（design-k3 §2.3・KRM-16 GUI 編集フォームは後波）。
// ponytail: workerd は CSV を実行時 read できない＝GUI 行の bundle は後波。既定 100 を
// resolver の fallback で解決（policy 経由・ハードコードでない）。
const OFFICIAL_THRESHOLD_KEY = "platinum_vote.official_threshold";
const OFFICIAL_THRESHOLD_DEFAULT = 100;

export const socialRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

// ── KRM-20 社会評価投影（統計のみ・公式ランキング配列は生成しない）──────────
export interface SocialEvalCounts {
  vote: number;
  like: number;
  dislike: number;
  favorite: number;
  follow: number;
  fork: number;
  proposal: number;
}
export interface SocialEvalProjection {
  node_id: string;
  counts: SocialEvalCounts;
}

// layer 0-3 のみ集計（layer4 除外）。authorId 指定時は本人自己評価（rater===author）を
// 集計前に除外（KRM-20）。公式ランキング配列は返さない＝統計（counts）のみ。
// ponytail: node→author の解決は component registry join（後波）。author は呼び出し側が
// 供給（route は ?author= クエリ）。registry 実装まで author 未知なら自己除外は無効。
export async function projectSocialEval(
  s: TruthStore,
  nodeId: string,
  authorId?: string,
): Promise<SocialEvalProjection> {
  const events = (await s.listEvents(`truth/${EVAL_TYPE}/`)).map(dataOf);
  const counts: SocialEvalCounts = {
    vote: 0, like: 0, dislike: 0, favorite: 0, follow: 0, fork: 0, proposal: 0,
  };
  for (const d of events) {
    if (d.target_node_id !== nodeId) continue;
    const layer = typeof d.target_layer === "number" ? d.target_layer : -1;
    if (layer < 0 || layer > SOCIAL_EVAL_LAYER_MAX) continue; // layer4 除外
    if (authorId && d.rater_id === authorId) continue; // 本人自己評価除外
    const kind = String(d.kind);
    if (kind in counts) counts[kind as EvalKind] += 1;
  }
  return { node_id: nodeId, counts };
}

// ── KRM-25 プラチナ投票集計（全員公開合計値 + 投票者内訳）─────────────────
export interface PlatinumVoteTally {
  target_id: string;
  total: number;
  breakdown: { voter_id: string; coins: number }[];
  official_threshold: number;
  candidate: boolean; // 閾値到達で公式昇格候補化（実昇格=人間ゲート）
}

export async function projectPlatinumVoteTally(
  s: TruthStore,
  targetId: string,
  threshold: number,
): Promise<PlatinumVoteTally> {
  const events = (await s.listEvents(`truth/${VOTE_TYPE}/`)).map(dataOf);
  const perVoter = new Map<string, number>();
  let total = 0;
  for (const d of events) {
    if (d.target_id !== targetId) continue;
    const coins = typeof d.coins === "number" ? d.coins : 0;
    total += coins;
    perVoter.set(String(d.voter_id), (perVoter.get(String(d.voter_id)) ?? 0) + coins);
  }
  const breakdown = [...perVoter.entries()].map(([voter_id, coins]) => ({ voter_id, coins }));
  return { target_id: targetId, total, breakdown, official_threshold: threshold, candidate: total >= threshold };
}

// 投票者が全対象に既に積んだプラチナコイン累計（=消費済）。frozen coin_event は付与のみ
// （grant_amount>=0・負値不可）ゆえ「デビット」は append-only の投票イベント自体が正本。
// 消費可能残高 = grantPlatinum 累計(projectLedger) − 本人の投票済コイン累計。
export async function projectCoinsSpent(s: TruthStore, voterId: string): Promise<number> {
  const events = (await s.listEvents(`truth/${VOTE_TYPE}/`)).map(dataOf);
  let spent = 0;
  for (const d of events) {
    if (d.voter_id !== voterId) continue;
    spent += typeof d.coins === "number" ? d.coins : 0;
  }
  return spent;
}

function evalEnvelope(id: string, raterId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0", id, source: "apps/api", type: EVAL_TYPE,
    time: new Date().toISOString(), dataschema: EVAL_SCHEMA,
    provenance: { generator_kind: "human", actor_id: raterId }, data,
  };
}
function voteEnvelope(id: string, voterId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0", id, source: "apps/api", type: VOTE_TYPE,
    time: new Date().toISOString(), dataschema: VOTE_SCHEMA,
    provenance: { generator_kind: "human", actor_id: voterId }, data,
  };
}

// POST /social/eval — 社会評価を append。rater_id はセッション principal 強制。
socialRoutes.post("/social/eval", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const nodeId = body && typeof body.target_node_id === "string" ? body.target_node_id : "";
  const layer = body && typeof body.target_layer === "number" ? body.target_layer : NaN;
  const kind = body && typeof body.kind === "string" ? body.kind : "";
  if (!nodeId || !(EVAL_KINDS as readonly string[]).includes(kind)) {
    return c.json({ error: "INVALID_EVAL", details: ["target_node_id + valid kind required"] }, 400);
  }
  if (!Number.isInteger(layer) || layer < 0 || layer > SOCIAL_EVAL_LAYER_MAX) {
    return c.json({ error: "INVALID_EVAL", details: [`target_layer must be 0-${SOCIAL_EVAL_LAYER_MAX}`] }, 400);
  }
  const raterId = c.get("actorId");
  const id = ulid();
  const res = await store(c).putEvent(evalEnvelope(id, raterId, {
    eval_id: id, target_node_id: nodeId, target_layer: layer, rater_id: raterId,
    kind, created_at: new Date().toISOString(), schema_version: SCHEMA_VERSION,
  }));
  if (res.status === "invalid") return c.json({ error: "INVALID_EVAL", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_EVAL", key: res.key }, 409);
  return c.json({ eval_id: id }, 201);
});

// GET /components/{node_id}/eval — 総合指標（統計のみ・公式ランキング非生成）。
// ?author= で node 著者を渡すと本人自己評価を除外（component registry join は後波）。
socialRoutes.get("/components/:node_id/eval", async (c) => {
  const nodeId = c.req.param("node_id");
  const author = c.req.query("author") || undefined;
  return c.json(await projectSocialEval(store(c), nodeId, author));
});

// POST /social/platinum-votes — プラチナ投票を append。voter_id はセッション principal
// 強制・1票=1coin・任意枚数。coins は正整数。消費可能残高（付与累計 − 投票済累計）を
// 投影し、不足なら 409 で拒否（V3-KRM-25・1票=1プラチナコイン）。
// ponytail: 残高投影→append は shop/indulgence と同じ TOCTOU 許容（原子ロック無し・append-only
// put-if-absent 前提）。同時多重投票の過消費が問題化したら per-actor ロックへ。
socialRoutes.post("/social/platinum-votes", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const targetId = body && typeof body.target_id === "string" ? body.target_id : "";
  const coins = body && typeof body.coins === "number" ? body.coins : 1;
  if (!targetId || !Number.isInteger(coins) || coins < 1) {
    return c.json({ error: "INVALID_VOTE", details: ["target_id required, coins>=1 integer"] }, 400);
  }
  const voterId = c.get("actorId");
  const s = store(c);
  const { platinum_coins } = await projectLedger(s, voterId);
  const spent = await projectCoinsSpent(s, voterId);
  const balance = platinum_coins - spent;
  if (balance < coins) {
    return c.json({ error: "INSUFFICIENT_COINS", balance, requested: coins }, 409);
  }
  const id = ulid();
  const res = await s.putEvent(voteEnvelope(id, voterId, {
    vote_id: id, target_id: targetId, voter_id: voterId, coins,
    created_at: new Date().toISOString(), schema_version: SCHEMA_VERSION,
  }));
  if (res.status === "invalid") return c.json({ error: "INVALID_VOTE", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_VOTE", key: res.key }, 409);
  return c.json({ vote_id: id }, 201);
});

// GET /proposals/{id}/votes — 公開合計値 + 投票者内訳。閾値到達で公式昇格候補化
// （notify=candidate・実昇格は人間ゲート・KRM-25）。
socialRoutes.get("/proposals/:id/votes", async (c) => {
  const targetId = c.req.param("id");
  const threshold = resolvePolicyInt(OFFICIAL_THRESHOLD_KEY, [], OFFICIAL_THRESHOLD_DEFAULT);
  return c.json(await projectPlatinumVoteTally(store(c), targetId, threshold));
});
