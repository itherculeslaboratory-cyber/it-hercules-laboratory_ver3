// V3-BBS-06/08: 掲示板の紛争解決は「通報」ではなく「指摘」ボタン。指摘タグ選択+理由記入を
// 必須とし、指摘者と被指摘者の二者間 room を開く(書込は当事者2名限定・進行中の議論は
// 他ユーザーも閲覧できる=非公開なのは書込権限のみ)。合意が得られれば被指摘者が提案した
// 修正表現へ元発言の表示を切り替える — これは既存 plaza-post.correction_of(plaza-routes.ts
// projectThread)がそのまま担う(新規フィールド不要・reuse-first)。1ヶ月合意なしは強制
// クローズ/アーカイブとし、未解決クローズがユーザーごとに5の倍数へ達するたびカルマ-1、
// 30回の指摘消費で1プラチナコイン消費(GOV-10 と同型だが掲示板側は別ストリームとして独立
// カウント・market-flag-routes.ts のコメントが「掲示板側は指摘機能自体が未実装」と明記して
// いた配線先がこのファイル)。評価への異議申立ても同じ二者間メカニズムを target_type="rating"
// で再利用する(BBS-08後段)。全 route PROTECTED(index.ts の auth middleware が actorId を set)。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { findPostById } from "./plaza-routes";
import { appendKarma } from "./ledger-routes";
import { PT_TYPE } from "./contribution";
import { BBS_DISPUTE_TTL_DAYS, BBS_DISPUTE_UNRESOLVED_KARMA_EVERY, BBS_DISPUTE_PT_FEE_EVERY } from "./plaza-constants";

const DISPUTE_TYPE = "ihl.plaza.dispute.v1";
const DISPUTE_SCHEMA = "schemas/events/plaza-dispute.schema.json";
const DISPUTE_MESSAGE_TYPE = "ihl.plaza.dispute_message.v1";
const DISPUTE_MESSAGE_SCHEMA = "schemas/events/plaza-dispute-message.schema.json";
const SCHEMA_VERSION = "1";

export const plazaDisputeRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

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

export interface DisputeRecord {
  dispute_id: string;
  initiator_id: string;
  respondent_id: string;
  target_type: "post" | "rating";
  target_id: string;
  tag: string;
  reason: string;
  created_at: string;
}

async function listDisputes(s: TruthStore): Promise<DisputeRecord[]> {
  return (await s.listEvents(`truth/${DISPUTE_TYPE}/`)).map(dataOf) as unknown as DisputeRecord[];
}

export interface DisputeMessage {
  message_id: string;
  dispute_id: string;
  actor_id: string;
  kind: "message" | "correction_proposal" | "accept" | "reject";
  body?: string;
  created_at: string;
}

async function listDisputeMessages(s: TruthStore, disputeId: string): Promise<DisputeMessage[]> {
  return (await s.listEvents(`truth/${DISPUTE_MESSAGE_TYPE}/${disputeId}/`))
    .map(dataOf)
    .map((d) => d as unknown as DisputeMessage)
    .sort((a, b) => (a.message_id < b.message_id ? -1 : 1));
}

export type DisputeStatus = "open" | "resolved_agreed" | "force_closed";

export interface DisputeProjection extends DisputeRecord {
  status: DisputeStatus;
  messages: DisputeMessage[];
}

// projectDispute — 現在の状態を都度再計算(常駐 DB 禁止・不変条項①)。合意成立
// (accept メッセージが存在)なら resolved_agreed。BBS_DISPUTE_TTL_DAYS 経過かつ未合意なら
// force_closed。それ以外は open。now を引数化し決定論テストを可能にする。
export function reduceDisputeStatus(dispute: DisputeRecord, messages: DisputeMessage[], now: Date): DisputeStatus {
  if (messages.some((m) => m.kind === "accept")) return "resolved_agreed";
  const ageMs = now.getTime() - new Date(dispute.created_at).getTime();
  if (ageMs > BBS_DISPUTE_TTL_DAYS * 24 * 60 * 60 * 1000) return "force_closed";
  return "open";
}

export async function projectDispute(s: TruthStore, disputeId: string, now: Date = new Date()): Promise<DisputeProjection | null> {
  const dispute = (await listDisputes(s)).find((d) => d.dispute_id === disputeId);
  if (!dispute) return null;
  const messages = await listDisputeMessages(s, disputeId);
  return { ...dispute, status: reduceDisputeStatus(dispute, messages, now), messages };
}

// POST /plaza/disputes — 指摘を開く。target_type="post"(既定)は plaza post、"rating" は
// market-rating の評価異議(target_id はレーティング側の識別子・本ファイルは所有しない
// ため存在検証はしない=呼び出し側の責務)。tag/reason は必須(通報との差別化=理由記入必須)。
plazaDisputeRoutes.post("/plaza/disputes", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const targetType = body?.target_type === "rating" ? "rating" : "post";
  const targetId = str(body?.target_id);
  const tag = str(body?.tag);
  const reason = str(body?.reason);
  if (!targetId) return c.json({ error: "INVALID_DISPUTE", details: ["target_id required"] }, 400);
  if (!tag) return c.json({ error: "INVALID_DISPUTE", details: ["tag required (指摘は理由タグ必須)"] }, 400);
  if (!reason.trim()) return c.json({ error: "INVALID_DISPUTE", details: ["reason required (指摘は理由記入必須)"] }, 400);

  const s = store(c);
  const actorId = c.get("actorId");
  let respondentId = "";
  if (targetType === "post") {
    const post = await findPostById(s, targetId);
    if (!post) return c.json({ error: "NOT_FOUND" }, 404);
    respondentId = str(post.actor_id);
    if (respondentId === actorId) return c.json({ error: "CANNOT_DISPUTE_OWN_POST" }, 400);
  } else {
    respondentId = str(body?.respondent_id);
    if (!respondentId) return c.json({ error: "INVALID_DISPUTE", details: ["respondent_id required for target_type=rating"] }, 400);
  }

  const disputeId = ulid();
  const data: Record<string, unknown> = {
    dispute_id: disputeId,
    initiator_id: actorId,
    respondent_id: respondentId,
    target_type: targetType,
    target_id: targetId,
    tag,
    reason,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  const key = `truth/${DISPUTE_TYPE}/${disputeId}.json`;
  const res = await s.putEventAt(key, envelope(DISPUTE_TYPE, DISPUTE_SCHEMA, disputeId, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_DISPUTE", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_DISPUTE", key: res.key }, 409);

  await maybeChargeDisputeIndictmentFee(s, actorId);
  return c.json({ dispute_id: disputeId, initiator_id: actorId, respondent_id: respondentId }, 201);
});

// GET /plaza/disputes/:dispute_id — 二者間 room の閲覧(誰でも可。書込のみ当事者限定)。
plazaDisputeRoutes.get("/plaza/disputes/:dispute_id", async (c) => {
  const view = await projectDispute(store(c), c.req.param("dispute_id"));
  if (!view) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json(view);
});

// POST /plaza/disputes/:dispute_id/messages — 当事者間の発言/修正提案/了承/却下。
// kind="accept" は被指摘者提案(correction_proposal)への指摘者了承(または逆)。実際の
// 表示切替は既存 correction_of(plaza-routes.ts)側で行う設計のため、ここでは合意の記録
// のみ担う(呼び出し側 UI が accept 後に POST /plaza/posts { correction_of: target_id } を
// 打つ=表示切替の実体は既存メカニズムを再利用・重複実装しない)。
plazaDisputeRoutes.post("/plaza/disputes/:dispute_id/messages", async (c) => {
  const disputeId = c.req.param("dispute_id");
  const s = store(c);
  const dispute = (await listDisputes(s)).find((d) => d.dispute_id === disputeId);
  if (!dispute) return c.json({ error: "NOT_FOUND" }, 404);

  const actorId = c.get("actorId");
  if (actorId !== dispute.initiator_id && actorId !== dispute.respondent_id) {
    return c.json({ error: "FORBIDDEN", details: ["only the two dispute parties may post"] }, 403);
  }

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const kind = ["message", "correction_proposal", "accept", "reject"].includes(str(body?.kind)) ? str(body?.kind) : "message";
  const messageId = ulid();
  const data: Record<string, unknown> = {
    message_id: messageId,
    dispute_id: disputeId,
    actor_id: actorId,
    kind,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (typeof body?.body === "string") data.body = body.body;
  const key = `truth/${DISPUTE_MESSAGE_TYPE}/${disputeId}/${messageId}.json`;
  const res = await s.putEventAt(key, envelope(DISPUTE_MESSAGE_TYPE, DISPUTE_MESSAGE_SCHEMA, messageId, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_MESSAGE", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_MESSAGE", key: res.key }, 409);
  return c.json({ message_id: messageId, kind }, 201);
});

// ── カルマ/プラチナ会計(BBS-08) ────────────────────────────────────────────

// 未解決クローズ(force_closed)の累計カウント。ユーザーごとに respondent 側で数える
// (指摘を無視して逃げ切った側にペナルティが付く設計=要件文「未解決クローズはユーザー
// ごとに個別カウント」)。
export async function countUnresolvedCloses(s: TruthStore, actorId: string, now: Date = new Date()): Promise<number> {
  const disputes = (await listDisputes(s)).filter((d) => d.respondent_id === actorId);
  let count = 0;
  for (const d of disputes) {
    const messages = await listDisputeMessages(s, d.dispute_id);
    if (reduceDisputeStatus(d, messages, now) === "force_closed") count += 1;
  }
  return count;
}

// maybeApplyUnresolvedClosePenalty — 未解決クローズカウントが
// BBS_DISPUTE_UNRESOLVED_KARMA_EVERY の倍数(5,10,15…)に達した回でのみカルマ-1。
// 呼び出しは冪等ではない(呼ぶ側が「新たに force_closed へ遷移した」タイミングでのみ
// 呼ぶ設計=二重計上防止は呼び出し側の責務。route 未配線・投影専用のためテストから直接叩く)。
export async function maybeApplyUnresolvedClosePenalty(s: TruthStore, actorId: string, closeCount: number): Promise<boolean> {
  if (closeCount > 0 && closeCount % BBS_DISPUTE_UNRESOLVED_KARMA_EVERY === 0) {
    await appendKarma(s, actorId, "value", -1, "dispute");
    return true;
  }
  return false;
}

// maybeChargeDisputeIndictmentFee — 指摘(dispute 起票)累計が BBS_DISPUTE_PT_FEE_EVERY の
// 倍数(30,60,90…)に達するたびプラチナ1枚消費(market-flag-routes.ts の
// maybeChargeIndictmentFee と同型・掲示板側は別イベントストリームのため独立カウント)。
async function maybeChargeDisputeIndictmentFee(s: TruthStore, actorId: string): Promise<void> {
  const filings = (await listDisputes(s)).filter((d) => d.initiator_id === actorId).length;
  if (filings > 0 && filings % BBS_DISPUTE_PT_FEE_EVERY === 0) {
    const id = ulid();
    await s.putEvent({
      specversion: "1.0",
      id,
      source: "apps/api",
      type: PT_TYPE,
      time: new Date().toISOString(),
      dataschema: "schemas/events/economy-pt-event.schema.json",
      provenance: { generator_kind: "human", actor_id: actorId },
      data: {
        pt_event_id: id,
        actor_id: actorId,
        delta: -1,
        reason_code: "indictment_fee",
        ref: "plaza-dispute",
        created_at: new Date().toISOString(),
        schema_version: SCHEMA_VERSION,
      },
    });
  }
}

// GET /plaza/users/:actor_id/dispute-status — 未解決クローズ累計投影(公開・読み取り専用)。
plazaDisputeRoutes.get("/plaza/users/:actor_id/dispute-status", async (c) => {
  const actorId = c.req.param("actor_id");
  const s = store(c);
  const count = await countUnresolvedCloses(s, actorId);
  return c.json({ actor_id: actorId, unresolved_close_count: count, next_karma_penalty_at: Math.ceil((count + 1) / BBS_DISPUTE_UNRESOLVED_KARMA_EVERY) * BBS_DISPUTE_UNRESOLVED_KARMA_EVERY });
});
