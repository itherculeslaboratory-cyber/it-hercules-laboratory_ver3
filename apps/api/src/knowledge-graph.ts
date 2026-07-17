// V3-WIK-20(相互リンクグラフ)+ V3-WIK-07(月次Lint)の共有基盤。設計書・コード・掲示板・
// 論文・フォーク系統を「同一の細胞構造」で相互参照できるようにする(文明の図書館)。
// 決定論・都度再計算(常駐グラフDB/インデックスは持たない・不変条項①)。既存の各機能が
// 既に保持している参照フィールド(plaza cite_refs・content cited_paper_ids/citations・
// fork/culture-template/proposal の forked_from)を prefix scan で束ねるだけで、専用の
// "file-board-registry" のような新規常駐資産は作らない(reuse-first)。
import { TruthStore } from "@ihl/truth";
import { CULTURE_TEMPLATE_TYPE } from "./culture";
import { PROPOSAL_TYPE } from "./proposal-routes";
import type { CiteRef } from "./plaza-routes";

// 各機能が既に使っている Truth 型(型を複製せず文字列のみ再掲・スキーマは
// schemas/events/*.schema.json が唯一正本・paper-match-routes.ts 等と同じ規約)。
const POST_TYPE = "ihl.plaza.post.v1";
const FORK_TYPE = "ihl.plaza.fork.v1";
const CONTENT_TYPE = "ihl.research.content.v1";

function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export interface GraphEdge {
  from: string;
  to: string;
}

export type GraphNodeKind = "post" | "content" | "fork" | "template" | "proposal";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  title: string; // topic(post) / title(content) / title(fork) / template_id(template) / proposal_id(proposal)
  forked_from?: string;
}

/**
 * buildReferenceIndex — 掲示板(cite_refs)・論文(cited_paper_ids/citations)・
 * フォーク系統(fork/culture-template/proposal の forked_from)を1回の prefix scan で
 * 束ね、node 一覧 + edge(from→to の参照)一覧を返す(決定論・都度再計算)。
 * WIK-20(知識セル横断投影)・WIK-07(孤立ページ検出)の共通データ源。
 */
export async function buildReferenceIndex(s: TruthStore): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const posts = (await s.listEvents(`truth/${POST_TYPE}/`)).map(dataOf);
  for (const p of posts) {
    const id = str(p.post_id);
    if (!id) continue;
    nodes.push({ id, kind: "post", title: str(p.topic) });
    for (const ref of (p.cite_refs as CiteRef[] | undefined) ?? []) {
      if (ref?.id) edges.push({ from: id, to: ref.id });
    }
  }

  const contents = (await s.listEvents(`truth/${CONTENT_TYPE}/`)).map(dataOf);
  for (const cn of contents) {
    const id = str(cn.content_id);
    if (!id) continue;
    nodes.push({ id, kind: "content", title: str(cn.title) });
    for (const pid of (cn.cited_paper_ids as string[] | undefined) ?? []) edges.push({ from: id, to: pid });
    for (const ref of (cn.citations as CiteRef[] | undefined) ?? []) {
      if (ref?.id) edges.push({ from: id, to: ref.id });
    }
  }

  const forks = (await s.listEvents(`truth/${FORK_TYPE}/`)).map(dataOf);
  for (const f of forks) {
    const id = str(f.fork_id);
    if (!id) continue;
    const forkedFrom = str(f.forked_from) || undefined;
    nodes.push({ id, kind: "fork", title: str(f.title), forked_from: forkedFrom });
    if (forkedFrom) edges.push({ from: id, to: forkedFrom });
  }

  const templates = (await s.listEvents(`truth/${CULTURE_TEMPLATE_TYPE}/`)).map(dataOf);
  for (const t of templates) {
    const id = str(t.version_id);
    if (!id) continue;
    const forkedFrom = str(t.forked_from) || undefined;
    nodes.push({ id, kind: "template", title: str(t.template_id), forked_from: forkedFrom });
    if (forkedFrom) edges.push({ from: id, to: forkedFrom });
  }

  const proposals = (await s.listEvents(`truth/${PROPOSAL_TYPE}/`)).map(dataOf);
  for (const pr of proposals) {
    const id = str(pr.proposal_id);
    const kind = str(pr.kind);
    if (!id || (kind !== "create" && kind !== "fork")) continue; // only origin events (create/fork) mint a new node identity
    const forkedFrom = str(pr.forked_from) || undefined;
    nodes.push({ id, kind: "proposal", title: id, forked_from: forkedFrom });
    if (forkedFrom) edges.push({ from: id, to: forkedFrom });
  }

  return { nodes, edges };
}

export interface KnowledgeCellLineage {
  ancestors: string[]; // forked_from を辿った祖先(近い順)
  descendants: string[]; // forked_from===id の直接の子(1階層)
}

export interface KnowledgeCell {
  id: string;
  kind: GraphNodeKind | "unknown";
  intent: string; // topic/title 等「なぜ来るのか」に相当する要約
  lineage: KnowledgeCellLineage;
  referenced_by: string[]; // このidを参照している他ノードのid(議論/引用からの逆参照)
}

const LINEAGE_DEPTH_CAP = 50; // ponytail: 循環/長大チェーンの安全弁(通常は数階層で収束)。

/**
 * projectKnowledgeCell — 1クエリで意図(intent)・系譜(lineage)・被引用(referenced_by)を
 * 返す横断投影(WIK-20「RAGの1クエリで意図・歴史・議論・系譜を返す」)。埋め込み/RAG は
 * 既定OFF(不変条項①)につき、ここでは構造化参照(cite_refs/cited_paper_ids/citations/
 * forked_from)のみを束ねる決定論版を提供する。id が既知の node に一致しなければ null。
 */
export async function projectKnowledgeCell(s: TruthStore, id: string): Promise<KnowledgeCell | null> {
  const { nodes, edges } = await buildReferenceIndex(s);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const self = byId.get(id);
  if (!self) return null;

  const ancestors: string[] = [];
  let cursor = self.forked_from;
  const seen = new Set<string>([id]);
  while (cursor && !seen.has(cursor) && ancestors.length < LINEAGE_DEPTH_CAP) {
    ancestors.push(cursor);
    seen.add(cursor);
    cursor = byId.get(cursor)?.forked_from;
  }
  const descendants = nodes.filter((n) => n.forked_from === id).map((n) => n.id).sort();
  const referenced_by = [...new Set(edges.filter((e) => e.to === id).map((e) => e.from))].sort();

  return {
    id,
    kind: self.kind,
    intent: self.title,
    lineage: { ancestors, descendants },
    referenced_by,
  };
}
