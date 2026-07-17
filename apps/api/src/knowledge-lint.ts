// V3-WIK-07 — 月次Lint(矛盾・孤立ページ・古い記述・リンク切れ)。既存機構を再利用するだけの
// 決定論チェッカー: 孤立ページ=knowledge-graph.ts の参照グラフで入出次数ゼロのノード、
// リンク切れ=plaza-routes.ts の citeTargetExists、矛盾=plaza-routes.ts の projectConsensus
// (divisive判定)。専用の常駐 lint デーモン/cron は追加しない(常駐なし・不変条項①)。
// 実行は手動 route(POST /wiki/lint)のみ — 月次スケジューリング(wrangler.toml [triggers]
// crons への追加)は config/consented-crons.json への人間の同意が要る人間ゲート
// (scripts/check-cron.mjs の既存 GATE と整合・research-agent-batch.ts と同じ規約)。
import { TruthStore } from "@ihl/truth";
import { buildReferenceIndex } from "./knowledge-graph";
import { citeTargetExists, projectConsensus, type CiteRef } from "./plaza-routes";

const POST_TYPE = "ihl.plaza.post.v1";

function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// STALE_DAYS — この日数より古い(かつ以後の活動が無い)投稿を「古い記述」とみなす。
// ponytail: 較正 knob。運用実測で調整(GUI後波・V3-GOV-17)。
export const STALE_DAYS = 180;

export type LintFindingKind = "orphan" | "broken_link" | "contradiction" | "stale";
export interface LintFinding {
  kind: LintFindingKind;
  id: string;
  detail: string;
}
export interface LintReport {
  run_at: string;
  findings: LintFinding[];
}

/**
 * runMonthlyLint — 矛盾/孤立ページ/古い記述/リンク切れを1回の決定論走査で検出する
 * (WIK-07)。now を注入可能にして TC を時刻非依存にする。
 */
export async function runMonthlyLint(s: TruthStore, now: Date = new Date()): Promise<LintReport> {
  const findings: LintFinding[] = [];

  // 孤立ページ: 参照グラフ(post/content/fork/template/proposal)で入出次数ゼロのノード。
  const { nodes, edges } = await buildReferenceIndex(s);
  const referenced = new Set(edges.map((e) => e.to));
  const referencing = new Set(edges.map((e) => e.from));
  for (const n of nodes) {
    if (!referenced.has(n.id) && !referencing.has(n.id)) {
      findings.push({ kind: "orphan", id: n.id, detail: `${n.kind} "${n.title}" has no incoming or outgoing references` });
    }
  }

  const posts = (await s.listEvents(`truth/${POST_TYPE}/`)).map(dataOf);

  // リンク切れ: 各投稿の cite_refs が実在しない参照(plaza-routes.ts citeTargetExists 再利用)。
  for (const p of posts) {
    for (const ref of (p.cite_refs as CiteRef[] | undefined) ?? []) {
      if (!(await citeTargetExists(s, ref))) {
        findings.push({ kind: "broken_link", id: str(p.post_id), detail: `cite ${ref.type}:${ref.id} does not resolve` });
      }
    }
  }

  // 古い記述: created_at が STALE_DAYS より古い投稿(以後の投稿活動なし=単純に created_at 判定)。
  const staleCutoff = now.getTime() - STALE_DAYS * 24 * 60 * 60 * 1000;
  for (const p of posts) {
    const createdAt = Date.parse(str(p.created_at));
    if (Number.isFinite(createdAt) && createdAt < staleCutoff) {
      findings.push({ kind: "stale", id: str(p.post_id), detail: `created_at ${p.created_at} is older than ${STALE_DAYS} days` });
    }
  }

  // 矛盾: スレッドごとに投稿を statement とみなし、projectConsensus(既存BBS-36 再利用)の
  // divisive 判定が立つスレを「未収束の対立」として検出(GET /plaza/threads/:id/consensus と
  // 同じ集約=重複実装を避ける・ここでは全スレッド横断でまとめて走らせる)。
  const byThread = new Map<string, string[]>();
  for (const p of posts) {
    const tid = str(p.thread_id);
    if (!tid) continue;
    (byThread.get(tid) ?? byThread.set(tid, []).get(tid)!).push(str(p.post_id));
  }
  for (const threadId of [...byThread.keys()].sort()) {
    const consensus = await projectConsensus(s, byThread.get(threadId)!);
    for (const row of consensus) {
      if (row.divisive) {
        findings.push({
          kind: "contradiction", id: threadId,
          detail: `statement ${row.statement_id}: agree=${row.agree} disagree=${row.disagree} (divisive)`,
        });
      }
    }
  }

  return { run_at: now.toISOString(), findings };
}
