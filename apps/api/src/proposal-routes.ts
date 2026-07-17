// KRM-24 改善案/仮説の状態機械（design-k3 §2.2/§2.3）。提案イベントは append-only
// （ihl.research.proposal.v1）、rank/state/trust は reduceProposal 投影で都度再計算
// （常駐 DB 禁止・不変条項①）。fork は rank=beginner 自動。書込 actor_id はセッション
// principal 強制（V3-AUT-17）。全 route は index.ts §1.5 gate 経由 PROTECTED。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";

// exported: V3-WIK-20(知識セル横断投影)が proposal の fork 系譜(forked_from)を
// 相互リンクグラフの一辺として再利用する(knowledge-graph.ts)。
export const PROPOSAL_TYPE = "ihl.research.proposal.v1";
const PROPOSAL_SCHEMA = "schemas/events/research-proposal.schema.json";
const SCHEMA_VERSION = "1";

export type Rank = "official" | "recommended" | "popular" | "beginner" | "minor";
export type ProposalState = "draft" | "hypothesis" | "supported" | "rejected";
const RANK_ORDER: Rank[] = ["minor", "beginner", "popular", "recommended", "official"];

// 仮説収束の閾値（proposal 固有・economy 定数ではない＝ここに集約）。hypothesis に
// 入り総投票数が MIN 以上で trust により収束：支持率≥SUPPORT→supported /
// ≤LOW→rejected（低支持アーカイブ）・中間は hypothesis 継続。
const CONVERGE_MIN_VOTES = 3;
const SUPPORT_TRUST = 0.6;
const LOW_TRUST = 0.4;

export const proposalRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

// ── reduceProposal（純関数投影・状態機械）──────────────────────────────────
export interface ProposalProjection {
  proposal_id: string;
  rank: Rank;
  state: ProposalState;
  support: number;
  reject: number;
  trust: number | null; // 支持/(支持+否定)・票なしは null
  archived: boolean; // rejected=低支持アーカイブ
}

export async function reduceProposal(s: TruthStore, proposalId: string): Promise<ProposalProjection> {
  const events = (await s.listEvents(`truth/${PROPOSAL_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.proposal_id === proposalId)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  let rank: Rank = "minor";
  let state: ProposalState = "draft";
  let support = 0;
  let reject = 0;
  for (const d of events) {
    const kind = String(d.kind);
    if (kind === "create") {
      rank = isRank(d.rank) ? d.rank : "minor";
      state = isState(d.state) ? d.state : "draft";
    } else if (kind === "fork") {
      rank = isRank(d.rank) ? d.rank : "beginner"; // fork は beginner 自動
      state = "draft";
    } else if (kind === "rank_change" && isRank(d.rank)) {
      rank = d.rank;
    } else if (kind === "hypothesis_transition" && isState(d.state)) {
      state = d.state;
    } else if (kind === "support") {
      support += 1;
    } else if (kind === "reject") {
      reject += 1;
    }
  }
  const totalVotes = support + reject;
  const trust = totalVotes > 0 ? support / totalVotes : null;
  // hypothesis 収束（trust で supported/rejected へ）。
  if (state === "hypothesis" && totalVotes >= CONVERGE_MIN_VOTES && trust !== null) {
    if (trust >= SUPPORT_TRUST) state = "supported";
    else if (trust <= LOW_TRUST) state = "rejected";
  }
  return { proposal_id: proposalId, rank, state, support, reject, trust, archived: state === "rejected" };
}

function isRank(v: unknown): v is Rank {
  return typeof v === "string" && (RANK_ORDER as string[]).includes(v);
}
function isState(v: unknown): v is ProposalState {
  return v === "draft" || v === "hypothesis" || v === "supported" || v === "rejected";
}

function envelope(id: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0", id, source: "apps/api", type: PROPOSAL_TYPE,
    time: new Date().toISOString(), dataschema: PROPOSAL_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId }, data,
  };
}
async function appendProposal(
  s: TruthStore, actorId: string, proposalId: string,
  kind: string, extra: Record<string, unknown> = {},
): Promise<{ ok: true } | { ok: false; status: number; body: unknown }> {
  const id = ulid();
  const res = await s.putEvent(envelope(id, actorId, {
    proposal_event_id: id, proposal_id: proposalId, actor_id: actorId, kind,
    created_at: new Date().toISOString(), schema_version: SCHEMA_VERSION, ...extra,
  }));
  if (res.status === "invalid") return { ok: false, status: 400, body: { error: "INVALID_PROPOSAL", details: res.errors } };
  if (res.status === "conflict") return { ok: false, status: 409, body: { error: "DUPLICATE_PROPOSAL", key: res.key } };
  return { ok: true };
}

// POST /proposals — 改善案 create（rank=minor / state=draft から開始）。
proposalRoutes.post("/proposals", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");
  const proposalId = typeof body.proposal_id === "string" && body.proposal_id ? body.proposal_id : ulid();
  const r = await appendProposal(store(c), actorId, proposalId, "create", { rank: "minor", state: "draft" });
  if (!r.ok) return c.json(r.body, r.status as 400 | 409);
  return c.json(await reduceProposal(store(c), proposalId), 201);
});

// POST /proposals/{id}/fork — フォーク（新 proposal・rank=beginner 自動・forked_from 連結）。
proposalRoutes.post("/proposals/:id/fork", async (c) => {
  const from = c.req.param("id");
  const actorId = c.get("actorId");
  const forkId = ulid();
  const r = await appendProposal(store(c), actorId, forkId, "fork", { rank: "beginner", forked_from: from });
  if (!r.ok) return c.json(r.body, r.status as 400 | 409);
  return c.json(await reduceProposal(store(c), forkId), 201);
});

// POST /proposals/{id}/transition — rank 昇格 / hypothesis 遷移 / 支持 / 否定。
// body.kind ∈ rank_change|hypothesis_transition|support|reject（+ rank / state）。
proposalRoutes.post("/proposals/:id/transition", async (c) => {
  const proposalId = c.req.param("id");
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const kind = body && typeof body.kind === "string" ? body.kind : "";
  const actorId = c.get("actorId");
  const extra: Record<string, unknown> = {};
  if (kind === "rank_change") {
    if (!isRank(body?.rank)) return c.json({ error: "INVALID_TRANSITION", details: ["rank required"] }, 400);
    // official/recommended への昇格はクライアント直指定を拒否（KRM-25）。上位ランクは
    // プラチナ投票の閾値到達（projectPlatinumVoteTally.candidate）経由の昇格候補化 + 人間
    // ゲートのみ。popular/beginner/minor 等の下位ランクは直接遷移を許す。
    if (body!.rank === "official" || body!.rank === "recommended") {
      return c.json(
        { error: "RANK_GATED", details: [`${body!.rank} promotion is gated behind platinum-vote threshold, not client-directed`] },
        403,
      );
    }
    extra.rank = body!.rank;
  } else if (kind === "hypothesis_transition") {
    if (!isState(body?.state)) return c.json({ error: "INVALID_TRANSITION", details: ["state required"] }, 400);
    extra.state = body!.state;
  } else if (kind !== "support" && kind !== "reject") {
    return c.json({ error: "INVALID_TRANSITION", details: ["kind must be rank_change|hypothesis_transition|support|reject"] }, 400);
  }
  const r = await appendProposal(store(c), actorId, proposalId, kind, extra);
  if (!r.ok) return c.json(r.body, r.status as 400 | 409);
  return c.json(await reduceProposal(store(c), proposalId), 200);
});
