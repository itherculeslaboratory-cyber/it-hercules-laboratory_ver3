// ガバナンス書込 route + 決定論投影(design-c5.md §K6 §2.1 slot037-040 / §2.3)。vote/dispute/
// precedent/flag を Truth へ append(多セグメントキーは putEventAt=put-if-absent・INSERT
// ONLY)。閾値・OS 昇格・紛争状態・判例検索は全て listEvents の prefix scan で都度再計算
// (常駐 DB 禁止・不変条項①)。LLM 呼び出しゼロ(判例 title/summary は close 時に人間 closer
// が供給・自動生成しない)。全 route PROTECTED(index.ts の auth middleware が gate・actorId
// を set)。書込 data.actor_id はセッション principal で強制刻印(V3-AUT-17)。定数は
// plaza-constants.ts 単一正本。karma 付与は ledger-routes.ts の grantKarmaCountIncrease を再利用。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { projectRanking, dedupVotes } from "./plaza-routes";
import { requireRole } from "./authz";
import { grantKarmaCountIncrease } from "./ledger-routes";
import { revokeActor } from "./denylist";
import { projectPt, PT_TYPE } from "./contribution";
import {
  DISPUTE_TTL_DAYS,
  GOV_FLAG_COUNT_STEPS,
  OS_PROMOTION_MIN_SCORE,
  GOV_DISPUTE_VOTE_WINDOW_DAYS,
  GOV_DISPUTE_LOSER_KARMA_STEPS,
} from "./plaza-constants";

const VOTE_TYPE = "ihl.gov.vote.v1";
const VOTE_SCHEMA = "schemas/events/gov-vote.schema.json";
const DISPUTE_TYPE = "ihl.gov.dispute.v1";
const DISPUTE_SCHEMA = "schemas/events/gov-dispute.schema.json";
const PRECEDENT_TYPE = "ihl.gov.precedent.v1";
const PRECEDENT_SCHEMA = "schemas/events/gov-precedent.schema.json";
const FLAG_TYPE = "ihl.gov.flag.v1";
const FLAG_SCHEMA = "schemas/events/gov-flag.schema.json";
const PT_SCHEMA = "schemas/events/economy-pt-event.schema.json";
const SCHEMA_VERSION = "1";
const TTL_MS = DISPUTE_TTL_DAYS * 24 * 60 * 60 * 1000;
const GOV_DISPUTE_VOTE_WINDOW_MS = GOV_DISPUTE_VOTE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export const govRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function envelope(type: string, schema: string, id: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type,
    time: new Date().toISOString(),
    dataschema: schema,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}

// ── Vote / Threshold / OS promotion(GOV-19/23)─────────────────────────────
// POST /gov/votes — 投票を append。キー truth/ihl.gov.vote.v1/<proposal_target>/<vote_id>.json。
// kind/value enum・必須は envelope schema 検証が gate。ルールも fork 対象(kind で分岐)。
govRoutes.post("/gov/votes", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const proposalTarget = str(body?.proposal_target);
  if (!proposalTarget) return c.json({ error: "INVALID_VOTE", details: ["proposal_target required"] }, 400);
  const actorId = c.get("actorId");
  const voteId = str(body?.vote_id) || ulid();
  const data: Record<string, unknown> = {
    vote_id: voteId,
    actor_id: actorId,
    proposal_target: proposalTarget,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (body?.kind !== undefined) data.kind = body.kind;
  if (body?.value !== undefined) data.value = body.value;
  if (typeof body?.adjust_to === "number") data.adjust_to = body.adjust_to;
  if (typeof body?.rank_to === "string") data.rank_to = body.rank_to;
  const key = `truth/${VOTE_TYPE}/${proposalTarget}/${voteId}.json`;
  const res = await store(c).putEventAt(key, envelope(VOTE_TYPE, VOTE_SCHEMA, voteId, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_VOTE", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_VOTE", key: res.key }, 409);
  return c.json({ vote_id: voteId }, 201);
});

// projectThreshold(s, rule_id, base) — kind=threshold_adjust の投票を scan → dedupVotes で
// 1 actor 1 票に畳んだ上で提案値ごとに approve/reject を集計、approve>reject の値のうち最新
// (vote_id 昇順で末尾)を採用。無投票/過半数否決なら base(caller 供給・economy-constants が
// 汎用 per-rule 閾値を持つとは示唆しない=批評家#3)。純算術・LLM なし。単一 actor の連投で
// 閾値を書き換え不能(投票水増し防止=批評家 major)。
export async function projectThreshold(s: TruthStore, ruleId: string, base: number): Promise<number> {
  const votes = dedupVotes(await s.listEvents(`truth/${VOTE_TYPE}/${ruleId}/`))
    .filter((v) => v.kind === "threshold_adjust" && typeof v.adjust_to === "number");
  const tally = new Map<number, { approve: number; reject: number; latest: string }>();
  for (const v of votes) {
    const val = v.adjust_to as number;
    const t = tally.get(val) ?? { approve: 0, reject: 0, latest: "" };
    if (v.value === "approve") t.approve += 1;
    else if (v.value === "reject") t.reject += 1;
    const vid = str(v.vote_id);
    if (vid > t.latest) t.latest = vid;
    tally.set(val, t);
  }
  const winners = [...tally.entries()]
    .filter(([, t]) => t.approve > t.reject)
    .sort((a, b) => (a[1].latest < b[1].latest ? -1 : 1));
  return winners.length ? winners[winners.length - 1][0] : base;
}

// GET /gov/rules/:rule_id/threshold?base=N — 投票で調整された閾値(無投票時は base)。
// base は caller 供給(query)。数値でなければ 400(批評家#3: 既定値正本は呼び出し側)。
govRoutes.get("/gov/rules/:rule_id/threshold", async (c) => {
  const ruleId = c.req.param("rule_id");
  const base = Number(c.req.query("base"));
  if (!Number.isFinite(base)) return c.json({ error: "INVALID_BASE", details: ["numeric base query required"] }, 400);
  const threshold = await projectThreshold(store(c), ruleId, base);
  return c.json({ rule_id: ruleId, base, threshold });
});

// projectOsPromotion(s, fork_id) — projectRanking スコア ≥ OS_PROMOTION_MIN_SCORE かつ
// kind=os_merge の approve が過半数(approve>reject)で promotable:true(GOV-23 /os/main 昇格)。
// os_merge 票は dedupVotes で 1 actor 1 票に畳む(単一 actor の自己昇格・ballot stuffing 防止=
// 批評家 major)。ranking スコアも dedup 済み vote 加重を使うため二重に水増し不能。
export async function projectOsPromotion(s: TruthStore, forkId: string) {
  const ranking = await projectRanking(s);
  const score = ranking.find((r) => r.target_id === forkId)?.score ?? 0;
  const osVotes = dedupVotes(await s.listEvents(`truth/${VOTE_TYPE}/${forkId}/`)).filter((v) => v.kind === "os_merge");
  let approve = 0;
  let reject = 0;
  for (const v of osVotes) {
    if (v.value === "approve") approve += 1;
    else if (v.value === "reject") reject += 1;
  }
  const promotable = score >= OS_PROMOTION_MIN_SCORE && approve > reject && approve > 0;
  return { fork_id: forkId, score, approve, reject, min_score: OS_PROMOTION_MIN_SCORE, promotable };
}

// GET /gov/os/promotion?fork_id=... — OS 昇格可否投影。
govRoutes.get("/gov/os/promotion", async (c) => {
  const forkId = c.req.query("fork_id") || "";
  if (!forkId) return c.json({ error: "INVALID_QUERY", details: ["fork_id required"] }, 400);
  return c.json(await projectOsPromotion(store(c), forkId));
});

// ── Dispute 二人部屋(GOV-01)────────────────────────────────────────────────
// POST /gov/disputes — 紛争を open。キー truth/ihl.gov.dispute.v1/<dispute_id>/<event_id>.json。
// open は category/respondent_id 必須(route 検証)。subject_ref は CiteRef 単一正本($ref)。
// opener=actor_id はセッション principal 強制。不服申立 route は無い(思想)。
govRoutes.post("/gov/disputes", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const category = str(body?.category);
  const respondentId = str(body?.respondent_id);
  if (!category) return c.json({ error: "INVALID_DISPUTE", details: ["category required (open)"] }, 400);
  if (!respondentId) return c.json({ error: "INVALID_DISPUTE", details: ["respondent_id required (open)"] }, 400);
  const actorId = c.get("actorId");
  const disputeId = str(body?.dispute_id) || ulid();
  const eventId = ulid();
  const data: Record<string, unknown> = {
    dispute_id: disputeId,
    actor_id: actorId,
    action: "open",
    category,
    respondent_id: respondentId,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (body?.subject_ref !== undefined) data.subject_ref = body.subject_ref;
  const key = `truth/${DISPUTE_TYPE}/${disputeId}/${eventId}.json`;
  const res = await store(c).putEventAt(key, envelope(DISPUTE_TYPE, DISPUTE_SCHEMA, eventId, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_DISPUTE", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_DISPUTE", key: res.key }, 409);
  return c.json({ dispute_id: disputeId }, 201);
});

// projectDispute(s, dispute_id) — event 列を時系列(event id ULID 昇順)に畳む。open を起点に
// participants={opener,respondent} を確定、message を時系列に、close で status を確定。close が
// 無く now>opened_at+DISPUTE_TTL_DAYS なら expired:true(UI 表示用・実 close は cron/手動 append)。
// V3-GOV-07: publicize を検出して public/publicized_at/vote_deadline/opener_role を確定し、
// 審理・投票本体(votes/vote-result/vote-resolve)はこの投影を土台にする。
export async function projectDispute(s: TruthStore, disputeId: string) {
  const events = (await s.listEvents(`truth/${DISPUTE_TYPE}/${disputeId}/`))
    .map(dataOf)
    .sort((a, b) => (str(a.created_at) < str(b.created_at) ? -1 : 1));
  const open = events.find((e) => e.action === "open");
  if (!open) return null;
  const participants = { opener: str(open.actor_id), respondent: str(open.respondent_id) };
  const messages = events
    .filter((e) => e.action === "message")
    .map((e) => ({ actor_id: str(e.actor_id), body: str(e.body), created_at: str(e.created_at) }));
  const close = events.find((e) => e.action === "close");
  const openedAt = str(open.created_at);
  let status: "open" | "resolved" | "force_closed" = "open";
  if (close) status = close.resolution === "force_closed" ? "force_closed" : "resolved";
  const expired = !close && Date.now() > Date.parse(openedAt) + TTL_MS;

  const publicize = events.find((e) => e.action === "publicize");
  const publicizedAt = publicize ? str(publicize.created_at) : null;
  const voteDeadline = publicizedAt
    ? new Date(Date.parse(publicizedAt) + GOV_DISPUTE_VOTE_WINDOW_MS).toISOString()
    : null;
  const voteResolveEvent = events.find((e) => e.action === "vote_resolve");

  return {
    dispute_id: disputeId,
    status,
    category: str(open.category),
    subject_ref: open.subject_ref ?? null,
    participants,
    messages,
    opened_at: openedAt,
    expired,
    public: !!publicize,
    publicized_at: publicizedAt,
    opener_role: publicize ? (str(publicize.opener_role) || null) : null,
    vote_deadline: voteDeadline,
    vote_resolved: !!voteResolveEvent,
    vote_result: voteResolveEvent ? (str(voteResolveEvent.value) || "tie") : null,
  };
}

// 参加者判定(opener/respondent の2名限定・第三者を拒否)。
function isParticipant(view: { participants: { opener: string; respondent: string } }, actorId: string): boolean {
  return actorId === view.participants.opener || actorId === view.participants.respondent;
}

// POST /gov/disputes/:dispute_id/messages — 発言を append。participants(opener/respondent)の
// 2名限定・第三者は 403。dispute 未 open は 404。
govRoutes.post("/gov/disputes/:dispute_id/messages", async (c) => {
  const disputeId = c.req.param("dispute_id");
  const s = store(c);
  const view = await projectDispute(s, disputeId);
  if (!view) return c.json({ error: "NOT_FOUND" }, 404);
  const actorId = c.get("actorId");
  if (!isParticipant(view, actorId)) return c.json({ error: "NOT_A_PARTICIPANT" }, 403);
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const eventId = ulid();
  const data: Record<string, unknown> = {
    dispute_id: disputeId,
    actor_id: actorId,
    action: "message",
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (body?.body !== undefined) data.body = body.body;
  const key = `truth/${DISPUTE_TYPE}/${disputeId}/${eventId}.json`;
  const res = await s.putEventAt(key, envelope(DISPUTE_TYPE, DISPUTE_SCHEMA, eventId, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_DISPUTE", details: res.errors }, 400);
  return c.json({ dispute_id: disputeId, event_id: eventId }, 201);
});

// appendPrecedent — dispute close 時に判例を append。title/category/summary は close 時点で
// 全て充足(LLM で derive しない=批評家#4)。キー truth/ihl.gov.precedent.v1/<precedent_id>.json。
async function appendPrecedent(
  s: TruthStore,
  actorId: string,
  disputeId: string,
  category: string,
  fields: { title: string; summary: string; tags?: unknown; culture_guide?: unknown },
) {
  const precedentId = ulid();
  const data: Record<string, unknown> = {
    precedent_id: precedentId,
    dispute_id: disputeId,
    title: fields.title,
    category,
    summary: fields.summary,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (typeof fields.culture_guide === "string") data.culture_guide = fields.culture_guide;
  if (Array.isArray(fields.tags)) data.tags = fields.tags;
  const key = `truth/${PRECEDENT_TYPE}/${precedentId}.json`;
  const res = await s.putEventAt(key, envelope(PRECEDENT_TYPE, PRECEDENT_SCHEMA, precedentId, actorId, data));
  return { precedentId, res };
}

// POST /gov/disputes/:dispute_id/close — 決着 + 判例確定(GOV-01/GOV-12)。参加者のみ close 可。
// request body: title・summary(必須)・tags?・culture_guide?。category は dispute から継承。
// resolution は resolved 既定(force_closed も可)。title/summary 欠落は 400(LLM で埋めない)。
govRoutes.post("/gov/disputes/:dispute_id/close", async (c) => {
  const disputeId = c.req.param("dispute_id");
  const s = store(c);
  const view = await projectDispute(s, disputeId);
  if (!view) return c.json({ error: "NOT_FOUND" }, 404);
  const actorId = c.get("actorId");
  if (!isParticipant(view, actorId)) return c.json({ error: "NOT_A_PARTICIPANT" }, 403);
  if (view.status !== "open") return c.json({ error: "ALREADY_CLOSED" }, 409);
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const title = str(body?.title);
  const summary = str(body?.summary);
  if (!title || !summary) {
    return c.json({ error: "INVALID_CLOSE", details: ["title and summary required (precedent is not LLM-derived)"] }, 400);
  }
  const resolution = body?.resolution === "force_closed" ? "force_closed" : "resolved";

  const eventId = ulid();
  const closeData: Record<string, unknown> = {
    dispute_id: disputeId,
    actor_id: actorId,
    action: "close",
    resolution,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  const closeKey = `truth/${DISPUTE_TYPE}/${disputeId}/${eventId}.json`;
  const closeRes = await s.putEventAt(closeKey, envelope(DISPUTE_TYPE, DISPUTE_SCHEMA, eventId, actorId, closeData));
  if (closeRes.status === "invalid") return c.json({ error: "INVALID_DISPUTE", details: closeRes.errors }, 400);

  const { precedentId, res } = await appendPrecedent(s, actorId, disputeId, view.category, {
    title,
    summary,
    tags: body?.tags,
    culture_guide: body?.culture_guide,
  });
  if (res.status === "invalid") return c.json({ error: "INVALID_PRECEDENT", details: res.errors }, 400);
  return c.json({ dispute_id: disputeId, precedent_id: precedentId, resolution }, 201);
});

// ── V3-GOV-07 プラチナ投票による紛争裁定(公開して投票)─────────────────────────
// POST /gov/disputes/:dispute_id/publicize — 当事者(opener/respondent)のみが選べる。
// body.opener_role(seller|buyer必須)で opener の市場ロールを宣言し、respondent は自動的に
// もう一方(勝敗確定時の敗者特定に使う)。open 状態(close 前)のみ・二重 publicize は 409。
govRoutes.post("/gov/disputes/:dispute_id/publicize", async (c) => {
  const disputeId = c.req.param("dispute_id");
  const s = store(c);
  const view = await projectDispute(s, disputeId);
  if (!view) return c.json({ error: "NOT_FOUND" }, 404);
  const actorId = c.get("actorId");
  if (!isParticipant(view, actorId)) return c.json({ error: "NOT_A_PARTICIPANT" }, 403);
  if (view.status !== "open") return c.json({ error: "ALREADY_CLOSED" }, 409);
  if (view.public) return c.json({ error: "ALREADY_PUBLIC" }, 409);
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const openerRole = str(body?.opener_role);
  if (openerRole !== "seller" && openerRole !== "buyer") {
    return c.json({ error: "INVALID_PUBLICIZE", details: ["opener_role must be 'seller' or 'buyer'"] }, 400);
  }
  const eventId = ulid();
  const data: Record<string, unknown> = {
    dispute_id: disputeId,
    actor_id: actorId,
    action: "publicize",
    opener_role: openerRole,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  const key = `truth/${DISPUTE_TYPE}/${disputeId}/${eventId}.json`;
  const res = await s.putEventAt(key, envelope(DISPUTE_TYPE, DISPUTE_SCHEMA, eventId, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_PUBLICIZE", details: res.errors }, 400);
  const after = await projectDispute(s, disputeId);
  return c.json({ dispute_id: disputeId, public: true, vote_deadline: after!.vote_deadline }, 201);
});

// projectDisputeVoteTally(s, dispute_id) — kind=dispute_verdict・proposal_target=dispute_id の
// 投票を集計(1 actor 1 票=put-if-absent の deterministic key で自然に保証・dedup 不要)。
export interface DisputeVoteTally {
  seller_votes: number;
  buyer_votes: number;
  total_voters: number;
  window_closed: boolean;
  winner: "seller" | "buyer" | "tie" | null; // window_closed でなければ null(未確定)
}
export async function projectDisputeVoteTally(
  s: TruthStore,
  disputeId: string,
  voteDeadline: string | null,
): Promise<DisputeVoteTally> {
  const votes = (await s.listEvents(`truth/${VOTE_TYPE}/${disputeId}/`))
    .map(dataOf)
    .filter((v) => v.kind === "dispute_verdict");
  let seller = 0;
  let buyer = 0;
  for (const v of votes) {
    if (v.value === "seller") seller += 1;
    else if (v.value === "buyer") buyer += 1;
  }
  const windowClosed = !!voteDeadline && Date.now() > Date.parse(voteDeadline);
  let winner: DisputeVoteTally["winner"] = null;
  if (windowClosed) winner = seller === buyer ? "tie" : seller > buyer ? "seller" : "buyer";
  return { seller_votes: seller, buyer_votes: buyer, total_voters: seller + buyer, window_closed: windowClosed, winner };
}

// GET /gov/disputes/:dispute_id/vote-result — 投票集計投影(公開されていなくても 404 では
// なく空集計を返す=紛争詳細取得と対称)。
govRoutes.get("/gov/disputes/:dispute_id/vote-result", async (c) => {
  const disputeId = c.req.param("dispute_id");
  const view = await projectDispute(store(c), disputeId);
  if (!view) return c.json({ error: "NOT_FOUND" }, 404);
  const tally = await projectDisputeVoteTally(store(c), disputeId, view.vote_deadline);
  return c.json({ dispute_id: disputeId, public: view.public, vote_deadline: view.vote_deadline, resolved: view.vote_resolved, ...tally });
});

// POST /gov/disputes/:dispute_id/votes — プラチナ投票(二択・1票=1PT消費・PT残高≥1で誰でも
// 投票可・quorumなし)。公開済み(publicize 済み)かつ投票期限内のみ受理。1 actor 1 票
// (deterministic key・二回目は 409=再投票不可)。
govRoutes.post("/gov/disputes/:dispute_id/votes", async (c) => {
  const disputeId = c.req.param("dispute_id");
  const s = store(c);
  const view = await projectDispute(s, disputeId);
  if (!view) return c.json({ error: "NOT_FOUND" }, 404);
  if (!view.public) return c.json({ error: "NOT_PUBLIC" }, 400);
  if (view.vote_deadline && Date.now() > Date.parse(view.vote_deadline)) {
    return c.json({ error: "VOTING_CLOSED" }, 409);
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const value = str(body?.value);
  if (value !== "seller" && value !== "buyer") {
    return c.json({ error: "INVALID_VOTE", details: ["value must be 'seller' or 'buyer'"] }, 400);
  }
  const voterId = c.get("actorId");
  const { balance } = await projectPt(s, voterId);
  if (balance < 1) return c.json({ error: "INSUFFICIENT_PT", balance }, 402);

  const voteId = ulid();
  const voteData: Record<string, unknown> = {
    vote_id: voteId,
    actor_id: voterId,
    kind: "dispute_verdict",
    proposal_target: disputeId,
    value,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  // deterministic key(actor 単位)= 1 actor 1 票。二回目は conflict=409(再投票不可・PT も
  // 消費しない=以下の PT 消費より前に判定するので二重課金は起きない)。
  const voteKey = `truth/${VOTE_TYPE}/${disputeId}/${voterId}.json`;
  const voteRes = await s.putEventAt(voteKey, envelope(VOTE_TYPE, VOTE_SCHEMA, voteId, voterId, voteData));
  if (voteRes.status === "invalid") return c.json({ error: "INVALID_VOTE", details: voteRes.errors }, 400);
  if (voteRes.status === "conflict") return c.json({ error: "ALREADY_VOTED" }, 409);

  const ptId = ulid();
  await s.putEvent({
    specversion: "1.0",
    id: ptId,
    source: "apps/api",
    type: PT_TYPE,
    time: new Date().toISOString(),
    dataschema: PT_SCHEMA,
    provenance: { generator_kind: "human", actor_id: voterId },
    data: {
      pt_event_id: ptId,
      actor_id: voterId,
      delta: -1,
      reason_code: "vote_spend",
      ref: disputeId,
      created_at: new Date().toISOString(),
      schema_version: SCHEMA_VERSION,
    },
  });
  return c.json({ vote_id: voteId, value, pt_spent: 1 }, 201);
});

// POST /gov/disputes/:dispute_id/vote-resolve — 投票期限経過後の勝敗確定(誰でも呼べる・
// projectDisputeVoteTally のゲートが実質の認可・misban-reversal/execute と同型)。敗者に
// Δcount+5 を1回だけ付与し(同数=引き分けはカルマ変動なし)、結果を判例R2に記録する
// (appendPrecedent 再利用・LLM 不使用=集計値からの決定論文言)。deterministic key の
// vote_resolve マーカーで二重実行を防ぐ(先に marker を append→conflict なら既実行)。
govRoutes.post("/gov/disputes/:dispute_id/vote-resolve", async (c) => {
  const disputeId = c.req.param("dispute_id");
  const s = store(c);
  const view = await projectDispute(s, disputeId);
  if (!view) return c.json({ error: "NOT_FOUND" }, 404);
  if (!view.public) return c.json({ error: "NOT_PUBLIC" }, 400);
  const tally = await projectDisputeVoteTally(s, disputeId, view.vote_deadline);
  if (!tally.window_closed) return c.json({ error: "VOTING_STILL_OPEN", vote_deadline: view.vote_deadline }, 409);
  if (view.vote_resolved) {
    return c.json({ dispute_id: disputeId, already_executed: true, ...tally }, 200);
  }

  const actorId = c.get("actorId");
  const eventId = ulid();
  const resolveData: Record<string, unknown> = {
    dispute_id: disputeId,
    actor_id: actorId,
    action: "vote_resolve",
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (tally.winner && tally.winner !== "tie") resolveData.value = tally.winner;
  // deterministic key(1 dispute につき1回)。conflict は稀な同時実行競合(先勝ちで十分)。
  const resolveKey = `truth/${DISPUTE_TYPE}/${disputeId}/vote-resolve.json`;
  const resolveRes = await s.putEventAt(resolveKey, envelope(DISPUTE_TYPE, DISPUTE_SCHEMA, eventId, actorId, resolveData));
  if (resolveRes.status === "invalid") return c.json({ error: "INVALID_VOTE_RESOLVE", details: resolveRes.errors }, 400);
  if (resolveRes.status === "conflict") {
    return c.json({ dispute_id: disputeId, already_executed: true, ...tally }, 200);
  }

  if (tally.winner && tally.winner !== "tie") {
    const loserRole = tally.winner === "seller" ? "buyer" : "seller";
    const loserId = view.opener_role === loserRole ? view.participants.opener : view.participants.respondent;
    await grantKarmaCountIncrease(s, loserId, GOV_DISPUTE_LOSER_KARMA_STEPS, "dispute", c.env.AUTH_DENYLIST);
  }

  await appendPrecedent(s, actorId, disputeId, view.category, {
    title: `プラチナ投票判定: 紛争 ${disputeId}`,
    summary: `売り手票=${tally.seller_votes} 買い手票=${tally.buyer_votes}(勝者=${tally.winner ?? "tie"})`,
    tags: ["platinum-vote"],
  });

  return c.json({ dispute_id: disputeId, resolved: true, ...tally }, 201);
});

// GET /gov/disputes/:dispute_id — 紛争状態投影(404 or view)。
govRoutes.get("/gov/disputes/:dispute_id", async (c) => {
  const view = await projectDispute(store(c), c.req.param("dispute_id"));
  if (!view) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json(view);
});

// ── V3-GOV-11 ホーム司法インボックスのプレビュー(最大5件・審理/投票本体は司法
// FeatureNode=上の /gov/disputes/* へ委譲)。─────────────────────────────────
export interface JudicialInboxItem {
  dispute_id: string;
  category: string;
  status: "open" | "resolved" | "force_closed";
  role: "opener" | "respondent";
  public: boolean;
  vote_deadline: string | null;
  opened_at: string;
}

/**
 * 本人が当事者(opener/respondent)の未決着(status="open")紛争を最大 limit 件返す
 * (都度再計算・常駐 DB 禁止)。並び順: 投票締切が近いものを優先(公開済み)、次に
 * 開始が新しいもの。DISPUTE_TYPE 全走査 + dispute_id ごとにグルーピングして
 * projectDispute と同型の折り畳みを行う(投影 index は別波・design-c2 §3.1)。
 */
export async function projectJudicialInboxPreview(
  s: TruthStore,
  actorId: string,
  limit = 5,
): Promise<JudicialInboxItem[]> {
  const all = (await s.listEvents(`truth/${DISPUTE_TYPE}/`)).map(dataOf);
  const byDispute = new Map<string, Record<string, unknown>[]>();
  for (const e of all) {
    const id = str(e.dispute_id);
    if (!id) continue;
    const arr = byDispute.get(id) ?? [];
    arr.push(e);
    byDispute.set(id, arr);
  }
  const items: JudicialInboxItem[] = [];
  for (const [disputeId, events] of byDispute) {
    const sorted = events.slice().sort((a, b) => (str(a.created_at) < str(b.created_at) ? -1 : 1));
    const open = sorted.find((e) => e.action === "open");
    if (!open) continue;
    const opener = str(open.actor_id);
    const respondent = str(open.respondent_id);
    if (actorId !== opener && actorId !== respondent) continue;
    const close = sorted.find((e) => e.action === "close");
    if (close) continue; // 未決着のみ(status="open")
    const publicize = sorted.find((e) => e.action === "publicize");
    const voteDeadline = publicize
      ? new Date(Date.parse(str(publicize.created_at)) + GOV_DISPUTE_VOTE_WINDOW_MS).toISOString()
      : null;
    items.push({
      dispute_id: disputeId,
      category: str(open.category),
      status: "open",
      role: actorId === opener ? "opener" : "respondent",
      public: !!publicize,
      vote_deadline: voteDeadline,
      opened_at: str(open.created_at),
    });
  }
  items.sort((a, b) => {
    if (a.vote_deadline && b.vote_deadline) return a.vote_deadline < b.vote_deadline ? -1 : 1;
    if (a.vote_deadline) return -1; // 締切が近い(=設定済み)ものを優先
    if (b.vote_deadline) return 1;
    return a.opened_at < b.opened_at ? 1 : -1; // 新しい開始を優先
  });
  return items.slice(0, limit);
}

// ── Precedent 判例(GOV-12)──────────────────────────────────────────────────
// projectPrecedents(s, q?, tag?) — title/summary/culture_guide 部分一致(q)・tags 一致(tag)。
export async function projectPrecedents(s: TruthStore, q?: string, tag?: string) {
  const needle = q?.toLowerCase();
  return (await s.listEvents(`truth/${PRECEDENT_TYPE}/`))
    .map(dataOf)
    .filter((p) => {
      if (needle) {
        const hay = `${str(p.title)}\n${str(p.summary)}\n${str(p.culture_guide)}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      if (tag) {
        const tags = Array.isArray(p.tags) ? (p.tags as unknown[]).map(String) : [];
        if (!tags.includes(tag)) return false;
      }
      return true;
    })
    .sort((a, b) => (str(a.precedent_id) < str(b.precedent_id) ? -1 : 1));
}

// GET /gov/precedents?q=&tag= — 判例検索。
govRoutes.get("/gov/precedents", async (c) => {
  const precedents = await projectPrecedents(store(c), c.req.query("q") || undefined, c.req.query("tag") || undefined);
  return c.json({ precedents });
});

// GET /gov/precedents/:precedent_id — 単一判例(全走査で precedent_id 一致)。
govRoutes.get("/gov/precedents/:precedent_id", async (c) => {
  const precedentId = c.req.param("precedent_id");
  const precedent = (await store(c).listEvents(`truth/${PRECEDENT_TYPE}/`)).map(dataOf).find((d) => d.precedent_id === precedentId);
  if (!precedent) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json({ precedent });
});

// ── Flag 不使用フラグ(GOV-09)────────────────────────────────────────────────
// POST /gov/flags — 行政指摘の不使用フラグを append(R2 DELETE せず論理無効化)+ 対象 owner へ
// grantKarmaCountIncrease(steps=GOV_FLAG_COUNT_STEPS=10)。operator の明示操作時のみ append
// (自動 poll しない=行政命令服従判断は人間ゲート V3-AIP-31)。
govRoutes.post("/gov/flags", requireRole("operator", "admin"), async (c) => {
  // GOV-09 ハード完了条件: K2 の requireRole(authz.ts)を配線済み — operator/admin ロールを
  // 帯びたセッションのみ通過(fail-closed)。DEV_TOKEN(roles=[])・一般セッションは 403。
  // 統一ロール taxonomy の人間裁定が下りても、この 2 role 名は運用者ゲートとして据置可能。
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const targetType = str(body?.target_type);
  const targetId = str(body?.target_id);
  const targetOwner = str(body?.target_owner);
  if (!targetType || !targetId || !targetOwner) {
    return c.json({ error: "INVALID_FLAG", details: ["target_type, target_id and target_owner required"] }, 400);
  }
  const actorId = c.get("actorId");
  const flagId = str(body?.flag_id) || ulid();
  const s = store(c);
  const data: Record<string, unknown> = {
    flag_id: flagId,
    actor_id: actorId,
    target_type: targetType,
    target_id: targetId,
    target_owner: targetOwner,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (typeof body?.reason === "string") data.reason = body.reason;
  const key = `truth/${FLAG_TYPE}/${targetId}/${flagId}.json`;
  const res = await s.putEventAt(key, envelope(FLAG_TYPE, FLAG_SCHEMA, flagId, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_FLAG", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_FLAG", key: res.key }, 409);
  // 対象 owner に Δcount+10 とフィボナッチ減点を台帳 append(reason_code は enum 内の "other")。
  // BAN 閾値を跨いだ場合は grantKarmaCountIncrease 内部で denylist 登録される(V3-KRM-04)。
  await grantKarmaCountIncrease(s, targetOwner, GOV_FLAG_COUNT_STEPS, "other", c.env.AUTH_DENYLIST);
  // V3-AUT-03(round-16 Q-REQ-03)「行政命令(V3-GOV-09)から denylist 登録を配線」: 行政指摘
  // による不使用フラグは閾値を跨がなくても無条件で即時失効させる(「開発者は裁判官には
  // ならないが行政命令には従う」= 人間ゲート裁定済みの既存方針・GOV-09 statement)。
  await revokeActor(c.env.AUTH_DENYLIST, targetOwner);
  return c.json({ flag_id: flagId, target_owner: targetOwner }, 201);
});
