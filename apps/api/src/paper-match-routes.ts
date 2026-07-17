// Paper Match / Gap / Hypothesis の薄い routes（design-k5 §2.1 / V3-PPR-01/06/30）。
// 判定は paper-match.ts の純関数に委譲し、ここは Truth 読込 + envelope append のみ。全 route は
// index.ts §1.5 gate 経由 PROTECTED（PUBLIC_ROUTES に載せない・deny-by-default）。書込 actor_id は
// セッション principal 強制（V3-AUT-17）。LLM 助言は既定 OFF＝不足キーは静的ヒント 1 行（§6 人間ゲート）。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { LATEX_FORBIDDEN } from "./research-constants";
import { makeLLMClient, AiDisabledError } from "./ai-kernel";
import {
  matchConditions,
  autoFillDescriptor,
  gapAnalysis,
  hintsForMissing,
  quadrantAnalysis,
  derivePropositions,
  hypothesisDraftsForGaps,
  type ConditionsP,
  type ObservationJson,
  type NeighborPaper,
  type GapPaper,
  type TemplateClaim,
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
// LLM OFF 既定の静的ヒント 1 行（§6・サーバ側RAG参照=決定論の推奨レンジ合成のみ。
// センサー設置法/類似観測の自然文生成はしない・不足キーが無ければ空文字）。
function staticHint(missing: string[], conditions: ConditionsP): string {
  if (!missing.length) return "";
  const parts = hintsForMissing(conditions, missing).map((h) => (h.range ? `${h.key}（推奨レンジ: ${h.range}）` : h.key));
  return `未充足の必須条件: ${parts.join(", ")}`;
}

// POST /research/paper-match — 条件P × 観測の照合 + Data Descriptor 自動充填（PPR-01/30）。
// content_id 指定時はその paper の conditions/sections/claims を土台にし、body の同名キーで上書き可能。
// llm_advice=true の明示トグル時のみ AI Kernel(A90・makeLLMClient)を呼ぶ（既定 OFF・§6 人間ゲート）。
// 実鍵未配線(IHL_AI_PROVIDER 未設定)なら AiDisabledError → llm_advice は null のまま返す
// （fabrication しない・FND-21 と同じ「実際に無効」な状態・未実装プレースホルダーではない）。
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

  let llm_advice: string | null = null;
  if (body.llm_advice === true) {
    try {
      const { text } = await makeLLMClient(c.env).complete({
        task: "generate",
        input: { missing: match.missing, conditions },
      });
      llm_advice = text;
    } catch (e) {
      if (!(e instanceof AiDisabledError)) throw e;
      // AI_DISABLED既定(§6人間ゲート・実鍵未配線) — llm_advice は null のまま返す。
    }
  }

  return c.json({ match, descriptor, hint: staticHint(match.missing, conditions), hints: hintsForMissing(conditions, match.missing), llm_advice });
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

// POST /research/quadrant — 観測データの4象限モデルで研究の空白領域を検出する(PPR-07)。
// P=条件充足(matchConditions)・Q=claim充足(autoFillDescriptor と同一実装)を観測ごとに
// 機械判定し、密度が閾値(既定5%)未満の象限を gaps として返す。gaps の各象限には
// 逆/裏/対偶(derivePropositions)+ 仮説論文タイトル・要旨案(hypothesisDraftsForGaps)を
// 同梱する。content_id 指定時はその paper の conditions/claims[0] を土台にする(未指定時は
// body.conditions/body.claim を使用)。「引用ネットワークのグラフ上で強調」はフロント
// レンダラ側の表示(本 route は gaps 配列を返すのみ・後波)。LLM 不使用・決定論(不変条項①)。
paperMatchRoutes.post("/research/quadrant", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  let paper: Record<string, unknown> = {};
  if (typeof body.content_id === "string") {
    const ev = await store(c).readEvent(contentKey(body.content_id));
    if (!ev) return c.json({ error: "CONTENT_NOT_FOUND" }, 404);
    paper = dataOf(ev);
  }
  const conditions = (body.conditions ?? paper.conditions ?? {}) as ConditionsP;
  const claims = (paper.claims ?? []) as TemplateClaim[];
  const claim = (body.claim as TemplateClaim | undefined) ?? claims[0];
  if (!claim) return c.json({ error: "INVALID_QUADRANT_REQUEST", details: ["claim required (body.claim or paper.claims[0])"] }, 400);
  const observations = Array.isArray(body.observations) ? (body.observations as ObservationJson[]) : [];
  const threshold = typeof body.threshold === "number" ? body.threshold : undefined;

  const result = quadrantAnalysis(conditions, claim, observations, threshold);
  const pLabel = typeof body.p_label === "string" && body.p_label ? body.p_label : "条件P";
  const qLabel = typeof body.q_label === "string" && body.q_label ? body.q_label : claim.statement || "主張Q";
  const propositions = derivePropositions(pLabel, qLabel);
  const hypothesis_drafts = hypothesisDraftsForGaps(result.gaps, pLabel, qLabel);

  return c.json({ ...result, propositions, hypothesis_drafts });
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
