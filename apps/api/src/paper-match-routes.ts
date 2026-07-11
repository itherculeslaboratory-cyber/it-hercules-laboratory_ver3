// Paper Match / Gap / Hypothesis の薄い routes（design-k5 §2.1 / V3-PPR-01/06/30）。
// 判定は paper-match.ts の純関数に委譲し、ここは Truth 読込 + envelope append のみ。全 route は
// index.ts §1.5 gate 経由 PROTECTED（PUBLIC_ROUTES に載せない・deny-by-default）。書込 actor_id は
// セッション principal 強制（V3-AUT-17）。LLM 助言は既定 OFF＝不足キーは静的ヒント 1 行（§6 人間ゲート）。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { LATEX_FORBIDDEN } from "./research-constants";
import {
  matchConditions,
  autoFillDescriptor,
  gapAnalysis,
  type ConditionsP,
  type ObservationJson,
  type NeighborPaper,
  type GapPaper,
} from "./paper-match";

export const paperMatchRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const CONTENT_TYPE = "ihl.research.content.v1";
const CONTENT_SCHEMA = "schemas/events/content.schema.json";
const SCHEMA_VERSION = "1";

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}
function contentKey(id: string): string {
  return `truth/${CONTENT_TYPE}/${id}.json`;
}
function envelope(actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id: ulid(), // §2.2: envelope.id は毎回 ULID。決定論キーは storage key 側のみ。
    source: "apps/api",
    type: CONTENT_TYPE,
    time: new Date().toISOString(),
    dataschema: CONTENT_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}
// Phase1 LaTeX 禁止（PPR-03）: \ と $ を除去して content.schema の pattern を通す（share route と同処理）。
function stripLatex(v: unknown): string {
  return String(v ?? "").replace(/[\\$]/g, "");
}
// LLM OFF 既定の静的ヒント 1 行（§6・不足キーがあれば列挙、無ければ空文字）。
function staticHint(missing: string[]): string {
  return missing.length ? `未充足の必須条件: ${missing.join(", ")}` : "";
}

// POST /research/paper-match — 条件P × 観測の照合 + Data Descriptor 自動充填（PPR-01/30）。
// content_id 指定時はその paper の conditions/sections/claims を土台にし、body の同名キーで上書き可能。
paperMatchRoutes.post("/research/paper-match", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  let paper: Record<string, unknown> = {};
  if (typeof body.content_id === "string") {
    const ev = await store(c).readEvent(contentKey(body.content_id));
    if (!ev) return c.json({ error: "CONTENT_NOT_FOUND" }, 404);
    paper = dataOf(ev);
  }
  const conditions = (body.conditions ?? paper.conditions ?? {}) as ConditionsP;
  const observation = (body.observation ?? {}) as ObservationJson;
  const sections = (body.sections ?? paper.sections) as Record<string, { filled: boolean; text: string }> | undefined;
  const claims = (body.claims ?? paper.claims) as
    | Array<{ claim_id: string; statement: string; evidence_keys?: string[] }>
    | undefined;
  const match = matchConditions(conditions, observation);
  const descriptor = autoFillDescriptor({ sections, conditions, claims }, observation);
  return c.json({ match, descriptor, hint: staticHint(match.missing) });
});

// POST /research/gap — 全種族横断のギャップ抽出（PPR-06）。neighbors はオフライン生成ベクトルを
// 呼び手が渡す（実埋め込み計算は §6 人間ゲート）。ベクトル無しでも data_gap を返す。
paperMatchRoutes.post("/research/gap", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  let paper = (body.paper ?? {}) as GapPaper;
  if (typeof body.content_id === "string") {
    const ev = await store(c).readEvent(contentKey(body.content_id));
    if (!ev) return c.json({ error: "CONTENT_NOT_FOUND" }, 404);
    const d = dataOf(ev);
    paper = { conditions: d.conditions as ConditionsP | undefined, vector: body.vector as number[] | undefined };
  }
  const neighbors = (Array.isArray(body.neighbors) ? body.neighbors : []) as NeighborPaper[];
  const observation = body.observation as ObservationJson | undefined;
  return c.json(gapAnalysis(paper, neighbors, observation));
});

// POST /research/content/:id/hypothesis — 仮説を別イベントとして append（PPR-01）。
// content は INSERT ONLY のため元 paper を更新せず、新 content(article) に claim を刻んで append。
// 観測が親 paper の必須条件を充足すれば status=evidenced（evidence_refs=充足キー）、さもなくば
// hypothesis 固定（機械が勝手に証拠化しない）。判定は matchConditions/autoFillDescriptor を再利用。
paperMatchRoutes.post("/research/content/:id/hypothesis", async (c) => {
  const id = c.req.param("id");
  const actorId = c.get("actorId");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const ev = await store(c).readEvent(contentKey(id));
  if (!ev) return c.json({ error: "CONTENT_NOT_FOUND" }, 404);
  const paper = dataOf(ev);

  const statement = stripLatex(body.statement);
  if (!statement) return c.json({ error: "INVALID_HYPOTHESIS", details: ["statement required"] }, 400);
  const conditions = (paper.conditions ?? {}) as ConditionsP;
  const observation = (body.observation ?? {}) as ObservationJson;
  const evidenceKeys = Array.isArray(body.evidence_keys) ? (body.evidence_keys as string[]) : undefined;

  // 単一の一時 claim を autoFillDescriptor に通して status/evidence_refs を機械決定（同一実装再利用）。
  const claimId = ulid();
  const { claims } = autoFillDescriptor(
    { conditions, claims: [{ claim_id: claimId, statement, evidence_keys: evidenceKeys ?? [] }] },
    observation,
  );
  const claim = claims[0];

  const newId = ulid();
  const data: Record<string, unknown> = {
    content_id: newId,
    actor_id: actorId, // V3-AUT-17 強制刻印
    content_type: "article",
    title: statement.slice(0, 200) || "hypothesis",
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
    cited_paper_ids: [id],
    claims: [claim],
  };
  if (typeof paper.project_id === "string") data.project_id = paper.project_id;

  const res = await store(c).putEventAt(contentKey(newId), envelope(actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_HYPOTHESIS", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_HYPOTHESIS", key: res.key }, 409);
  return c.json({ content_id: newId, paper_id: id, claim }, 201);
});
