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
  autoGeneratePaperDraft,
  computeLivingPaperGraph,
  reviewPipeline,
  computeConfidence,
  canTransitionHypothesis,
  promoteRepresentativeHypothesis,
  buildCitationEdges,
  computeSectionsCompleteness,
  CONFIDENCE_WEIGHTS_DEFAULT,
  type ConditionsP,
  type ObservationJson,
  type NeighborPaper,
  type GapPaper,
  type TemplateClaim,
  type UnifiedMeasurement,
  type ConfidenceWeights,
  type HypothesisState,
  type HypothesisCandidate,
  type CiteRefLike,
} from "./paper-match";

export const paperMatchRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const CONTENT_TYPE = "ihl.research.content.v1";
const CONTENT_SCHEMA = "schemas/events/content.schema.json";
const SCHEMA_VERSION = "1";
// V3-PPR-14「更新履歴を表示し自動管理する」用の履歴イベント(bridge波でスキーマ追加済み・
// このファイルは初めて発行側コードを書く)。
const GRAPH_UPDATE_TYPE = "ihl.research.graph_update.v1";
const GRAPH_UPDATE_SCHEMA = "schemas/events/ppr-graph-update.schema.json";
// V3-PPR-08で追加済みの汎用リンク型を「テンプレfork」の血統記録に転用(新規スキーマ0本・
// link_kind="derived_from"が意味的にfork元参照とそのまま一致するため)。
const CITATION_LINK_TYPE = "ihl.citation.link.v1";
const CITATION_LINK_SCHEMA = "schemas/events/citation-link.schema.json";
// V3-PPR-24/25(design35 §A-5・bridge2でスキーマ追加済み)。研究循環7ノード型+knowledge_evidence
// を content.schema.json を触らず独立イベント列で持つ受け皿。この艦は投影route(発行/一覧/詳細)を書く。
const CYCLE_NODE_TYPE = "ihl.ppr.cycle_node.v1";
const CYCLE_NODE_SCHEMA = "schemas/events/ppr-cycle-node.schema.json";
const CYCLE_NODE_TYPES = [
  "review",
  "hypothesis",
  "replication_proposal",
  "replication_result",
  "research_gap",
  "comment",
  "correction_note",
  "knowledge_evidence",
] as const;
function cycleNodeKey(nodeId: string): string {
  return `truth/${CYCLE_NODE_TYPE}/${nodeId}.json`;
}

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
// envelope() は CONTENT_TYPE 固定のため、graph_update/citation-link/ppr-cycle-node 等の
// 別イベント型にはこの汎用版を使う(research-content-routes.ts/project-routes.ts と同型)。
function envelopeFor(type: string, schema: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id: ulid(),
    source: "apps/api",
    type,
    time: new Date().toISOString(),
    dataschema: schema,
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

// POST /research/auto-draft — 統一フォーマットの観測データ(measurements[])のみから論文
// 下書きを自動生成する(PPR-20)。非永続プレビュー(suggestTags と同じ規約=呼び手が確認して
// 別途 POST /research/content で書込む・機械が勝手に paper を作らない)。
paperMatchRoutes.post("/research/auto-draft", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const observations = Array.isArray(body.observations)
    ? (body.observations as { measurements?: UnifiedMeasurement[] }[])
    : [];
  const title = typeof body.title === "string" && body.title ? body.title : "無題(自動生成下書き)";
  return c.json({ ...autoGeneratePaperDraft(observations, { title }), persisted: false });
});

// POST /research/graph/update — Living Paper(V3-PPR-14)グラフ自動更新プレビュー。
// 「観測データが追加されるたびグラフ・統計値・4象限・結果Q・信頼度を全自動更新する」
// の再計算式のみを提供する(POST /research/auto-draft と同じ非永続プレビュー規約・
// persisted:false=呼び手が確認して別途 POST /research/content で書込む)。content_id
// 指定時はその paper の conditions/claims を土台にする(未指定時は body 直指定)。
// 要件本文が求める「更新履歴の自動保存・表示」は新規 Truth イベント型
// (ihl.research.graph_update.v1)の追加を要し、schemas/ + packages/truth のコード
// 生成(本艦の書いてよい場所=apps/api/src・tests の外)が必要なため対象外——
// 持ち越し(次波での設計判断・KIT-TEMPLATE 差し戻し経路参照)。
paperMatchRoutes.post("/research/graph/update", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  let paper: Record<string, unknown> = {};
  if (typeof body.content_id === "string") {
    const ev = await store(c).readEvent(contentKey(body.content_id));
    if (!ev) return c.json({ error: "CONTENT_NOT_FOUND" }, 404);
    paper = dataOf(ev);
  }
  const conditions = (body.conditions ?? paper.conditions ?? {}) as ConditionsP;
  const claims = (body.claims ?? paper.claims) as
    | Array<{ claim_id: string; statement: string; evidence_keys?: string[] }>
    | undefined;
  const sections = (body.sections ?? paper.sections) as Record<string, { filled: boolean; text: string }> | undefined;
  const observations = Array.isArray(body.observations) ? (body.observations as ObservationJson[]) : [];
  const threshold = typeof body.threshold === "number" ? body.threshold : undefined;
  const graph = computeLivingPaperGraph({ sections, conditions, claims }, observations, { threshold });
  return c.json({ ...graph, persisted: false });
});

// POST /research/content/:id/fork-template — 論文テンプレートのフォーク(V3-PPR-14
// 「論文テンプレートもフォーク可能にする」)。:id は元となる paper の content_id(テンプレート)。
// sections/conditions/claims をコピーした新規 paper content を作成し、fork 元との血統を
// citation-link(link_kind="derived_from"・V3-PPR-08で追加済みの汎用型を再利用・新規スキーマ
// 0本)として記録、初回の更新履歴を ppr-graph-update(V3-PPR-14で追加済み)として append する。
// content.schema.json 自体は書き換えない(不変・本艦glob外)。
paperMatchRoutes.post("/research/content/:id/fork-template", async (c) => {
  const sourceId = c.req.param("id");
  const s = store(c);
  const sourceEv = await s.readEvent(contentKey(sourceId));
  if (!sourceEv) return c.json({ error: "TEMPLATE_NOT_FOUND" }, 404);
  const source = dataOf(sourceEv);
  if (source.content_type !== "paper") {
    return c.json({ error: "TEMPLATE_NOT_PAPER", details: ["fork-template は content_type=paper のみ対象"] }, 400);
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");
  const newContentId = typeof body.content_id === "string" && body.content_id ? body.content_id : ulid();
  const sections = source.sections as Record<string, { filled: boolean; text: string }> | undefined;
  const conditions = source.conditions as ConditionsP | undefined;
  const claims = source.claims;
  const newData: Record<string, unknown> = {
    content_id: newContentId,
    actor_id: actorId,
    content_type: "paper",
    title: typeof body.title === "string" && body.title ? body.title : `${String(source.title ?? "")}(fork)`,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
    sections: sections ?? {},
    completeness_pct: computeSectionsCompleteness(sections),
  };
  if (conditions) newData.conditions = conditions;
  if (claims !== undefined) newData.claims = claims;
  const createRes = await s.putEventAt(contentKey(newContentId), envelope(actorId, newData));
  if (createRes.status === "invalid") return c.json({ error: "INVALID_CONTENT", details: createRes.errors }, 400);
  if (createRes.status === "conflict") return c.json({ error: "DUPLICATE_CONTENT", key: createRes.key }, 409);

  // 血統記録(derived_from) — 新規スキーマ0本(既存 citation-link を fork 元参照に転用)。
  const linkId = ulid();
  await s.putEventAt(
    `truth/${CITATION_LINK_TYPE}/${newContentId}/${linkId}.json`,
    envelopeFor(CITATION_LINK_TYPE, CITATION_LINK_SCHEMA, actorId, {
      link_id: linkId,
      content_id: newContentId,
      target_ref: { type: "paper", id: sourceId },
      link_kind: "derived_from",
      actor_id: actorId,
      created_at: new Date().toISOString(),
      schema_version: SCHEMA_VERSION,
    }),
  );

  // 初回更新履歴(V3-PPR-14「更新履歴を表示し自動管理する」) — fork 直後のグラフ状態を1件目として積む。
  const graph = computeLivingPaperGraph({ sections, conditions, claims: claims as TemplateClaim[] | undefined }, [], {});
  const updateId = ulid();
  await s.putEventAt(
    `truth/${GRAPH_UPDATE_TYPE}/${newContentId}/${updateId}.json`,
    envelopeFor(GRAPH_UPDATE_TYPE, GRAPH_UPDATE_SCHEMA, actorId, {
      update_id: updateId,
      content_id: newContentId,
      actor_id: actorId,
      triggered_by: `template_fork:${sourceId}`,
      confidence: graph.confidence,
      observation_count: graph.observation_count,
      graph_snapshot: graph,
      created_at: new Date().toISOString(),
      schema_version: SCHEMA_VERSION,
    }),
  );

  return c.json({ content_id: newContentId, forked_from: sourceId, key: createRes.key }, 201);
});

// GET /research/content/:id/update-history — V3-PPR-14 更新履歴投影(created_at 昇順・O(1)
// prefix scan=content_id ごとに分離されたキー空間のため全件走査ではない)。
paperMatchRoutes.get("/research/content/:id/update-history", async (c) => {
  const id = c.req.param("id");
  const rows = (await store(c).listEvents(`truth/${GRAPH_UPDATE_TYPE}/${id}/`))
    .map(dataOf)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.update_id).localeCompare(String(b.update_id)));
  return c.json({ content_id: id, updates: rows });
});

// POST /research/cycle-nodes — V3-PPR-24/25 研究循環ノード(review/hypothesis/
// replication_proposal/replication_result/research_gap/comment/correction_note/
// knowledge_evidence)の append(INSERT ONLY・put-if-absent 409)。「編集でなく訂正投稿」
// (PPR-25)方針どおり、既存ノードへの update/delete route は作らない — 訂正は node_type=
// "correction_note" を subject_ref で元ノードへ向けて新規 append することで表す(store.ts自体が
// update/delete メソッドを持たないためこの規律は route を書かなくても構造的に守られる)。
// knowledge_evidence の「主な説(leading_hypotheses)」は配列のまま渡す(単数へ潰さない・PPR-24)。
paperMatchRoutes.post("/research/cycle-nodes", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const actorId = c.get("actorId");
  if (!(CYCLE_NODE_TYPES as readonly string[]).includes(String(body.node_type))) {
    return c.json(
      { error: "INVALID_NODE_TYPE", details: [`node_type must be one of ${CYCLE_NODE_TYPES.join("/")}`] },
      400,
    );
  }
  const nodeId = typeof body.node_id === "string" && body.node_id ? body.node_id : ulid();
  const data: Record<string, unknown> = {
    node_id: nodeId,
    node_type: body.node_type,
    actor_id: actorId, // V3-AUT-17 強制刻印
    created_at: typeof body.created_at === "string" ? body.created_at : new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (body.subject_ref !== undefined) data.subject_ref = body.subject_ref;
  if (body.sections !== undefined) data.sections = body.sections;
  const res = await store(c).putEventAt(cycleNodeKey(nodeId), envelopeFor(CYCLE_NODE_TYPE, CYCLE_NODE_SCHEMA, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_CYCLE_NODE", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_CYCLE_NODE", key: res.key }, 409);
  return c.json({ node_id: nodeId, key: res.key }, 201);
});

// GET /research/cycle-nodes — 一覧投影(?node_type=・?subject_id= フィルタ・node_id 昇順決定論)。
// subject_id は subject_ref.id への完全一致(同じ subject を巡る review/replication_result/
// research_gap 等を横断で辿るための最小結合・新規索引は作らない=都度 prefix scan)。
paperMatchRoutes.get("/research/cycle-nodes", async (c) => {
  const nodeType = c.req.query("node_type");
  const subjectId = c.req.query("subject_id");
  const items = (await store(c).listEvents(`truth/${CYCLE_NODE_TYPE}/`))
    .map(dataOf)
    .filter((d) => !nodeType || d.node_type === nodeType)
    .filter((d) => !subjectId || (d.subject_ref as { id?: string } | undefined)?.id === subjectId)
    .sort((a, b) => String(a.node_id).localeCompare(String(b.node_id)));
  return c.json({ items });
});

// GET /research/cycle-nodes/:id — 詳細投影(O(1)・キーが node_id 直下のためprefix scan不要)。
paperMatchRoutes.get("/research/cycle-nodes/:id", async (c) => {
  const id = c.req.param("id");
  const ev = await store(c).readEvent(cycleNodeKey(id));
  if (!ev) return c.json({ error: "CYCLE_NODE_NOT_FOUND" }, 404);
  return c.json(dataOf(ev));
});

// POST /research/review — AI査読パイプライン段階1-5(構造/欠損/再現性/整合性/統計)を
// 決定論算出する(V3-PPR-05)。段階6(LLM要約・改善提案)は含めない(既存 llm_advice
// トグル=POST /research/paper-match の管轄のまま・§6人間ゲート)。
paperMatchRoutes.post("/research/review", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const sections = body.sections as Record<string, { filled: boolean; text: string }> | undefined;
  const conditions = (body.conditions ?? {}) as ConditionsP;
  const measurements = Array.isArray(body.measurements) ? (body.measurements as UnifiedMeasurement[]) : [];
  const observation = (body.observation ?? {}) as ObservationJson;
  return c.json(reviewPipeline({ sections, conditions, measurements, observation }));
});

// POST /research/confidence — 論文/仮説の信頼度自動算出(V3-PPR-15)。
// f_data=1-e^(-k・n)/f_consistency=n11/(n11+n10+ε)/f_votes=v+/(v+ +v- +α) の重み付き和。
paperMatchRoutes.post("/research/confidence", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const n = Number(body.n ?? 0);
  const n11 = Number(body.n11 ?? 0);
  const n10 = Number(body.n10 ?? 0);
  const votesUp = Number(body.votes_up ?? 0);
  const votesDown = Number(body.votes_down ?? 0);
  const weights = (body.weights ?? CONFIDENCE_WEIGHTS_DEFAULT) as ConfidenceWeights;
  const confidence = computeConfidence(n, n11, n10, votesUp, votesDown, weights);
  return c.json({ confidence, weights });
});

// POST /research/hypothesis/transition — draft→hypothesis→supported/rejected→archived
// の許可判定(V3-PPR-15)。
paperMatchRoutes.post("/research/hypothesis/transition", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const from = body.from as HypothesisState;
  const to = body.to as HypothesisState;
  return c.json({ from, to, allowed: canTransitionHypothesis(from, to) });
});

// POST /research/hypothesis/promote — 代表仮説昇格(上位1つ・supported の中から
// confidence 最大)で分岐を収束させる(V3-PPR-15)。
paperMatchRoutes.post("/research/hypothesis/promote", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const candidates = Array.isArray(body.candidates) ? (body.candidates as HypothesisCandidate[]) : [];
  return c.json({ representative: promoteRepresentativeHypothesis(candidates) });
});

// GET /research/content/:id/citation-graph — 引用の双方向リンク + tombstone 判定
// (V3-PPR-08)。既存 content.citations(PPR-23で永続化済みのCiteRef[])を入力にし、
// paper 種別の引用先のみ実在確認(url/book/observationは自ホストTruth外の参照のため
// tombstone 判定の対象外=常に実在扱い)。Citationイベント自体は削除しない(INSERT ONLY)。
paperMatchRoutes.get("/research/content/:id/citation-graph", async (c) => {
  const id = c.req.param("id");
  const s = store(c);
  const ev = await s.readEvent(contentKey(id));
  if (!ev) return c.json({ error: "CONTENT_NOT_FOUND" }, 404);
  const citations = (dataOf(ev).citations ?? []) as CiteRefLike[];
  const existing = new Set<string>();
  for (const ref of citations) {
    if (ref.type === "paper") {
      if (await s.readEvent(contentKey(ref.id))) existing.add(ref.id);
    } else {
      existing.add(ref.id); // url/book/observation: 自ホストTruth外の参照はtombstone対象外
    }
  }
  return c.json({ content_id: id, edges: buildCitationEdges(id, citations, existing) });
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
