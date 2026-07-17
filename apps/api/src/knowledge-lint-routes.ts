// V3-WIK-07 — 月次Lint(矛盾/孤立ページ/古い記述/リンク切れ)を実行し ihl.research.wiki_node.v1
// (level="lint_log")に log.md 形式で記録する。既存 WIK-01 の Wiki ノード型を再利用し、新規
// event型は作らない(level enum に "lint_log" を追加しただけ・schemas/events/wiki-node.schema.json)。
// 実行は手動 route のみ(常駐なし)。月次スケジューリングは research-agent-batch.ts の
// 新聞バッチと同じく §6 人間ゲート(wrangler.toml [triggers] crons + config/consented-crons.json)。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { runMonthlyLint, type LintReport } from "./knowledge-lint";

export const knowledgeLintRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const WIKI_TYPE = "ihl.research.wiki_node.v1";
const WIKI_SCHEMA = "schemas/events/wiki-node.schema.json";
const SCHEMA_VERSION = "1";

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}
async function sha1hex(input: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** renderLintLogMarkdown — findings を log.md 形式(種別ごとの見出し+箇条書き)へ整形(WIK-07)。 */
export function renderLintLogMarkdown(report: LintReport): string {
  const lines = [`# lint run ${report.run_at}`, ""];
  const kinds: LintReport["findings"][number]["kind"][] = ["contradiction", "orphan", "stale", "broken_link"];
  for (const kind of kinds) {
    const rows = report.findings.filter((f) => f.kind === kind);
    lines.push(`## ${kind} (${rows.length})`);
    for (const r of rows) lines.push(`- ${r.id}: ${r.detail}`);
    lines.push("");
  }
  return lines.join("\n").replace(/[\\$]/g, ""); // content/wiki-node の LaTeX 禁止規約に合わせて除去
}

// POST /wiki/lint — 月次Lintを手動実行し、結果を wiki_node(level=lint_log)として append する
// (WIK-07)。node_id は sha1(lint_log|global|findings のハッシュ) で決定論(同一結果の再実行は
// 冪等・put-if-absent 409)。
knowledgeLintRoutes.post("/wiki/lint", async (c) => {
  const s = store(c);
  const report = await runMonthlyLint(s, new Date());
  const summary = renderLintLogMarkdown(report);
  const contentHash = await sha1hex(JSON.stringify(report.findings));
  const nodeId = await sha1hex(`lint_log|global|${contentHash}`);
  const data = {
    node_id: nodeId,
    level: "lint_log",
    scope_ref: "global",
    summary_markdown: summary,
    source_event_ids: report.findings.map((f) => f.id),
    created_at: report.run_at,
    schema_version: SCHEMA_VERSION,
  };
  const res = await s.putEventAt(`truth/${WIKI_TYPE}/${nodeId}.json`, {
    specversion: "1.0",
    id: ulid(),
    source: "apps/api",
    type: WIKI_TYPE,
    time: report.run_at,
    dataschema: WIKI_SCHEMA,
    provenance: { generator_kind: "agent", agent_name: "claude-code" },
    data,
  });
  if (res.status === "invalid") return c.json({ error: "INVALID_LINT_LOG", details: res.errors }, 400);
  // 同一 findings の再実行(冪等)も 200 で現行 report を返す(致命ではない=409 にしない)。
  return c.json({ node_id: nodeId, ...report }, 200);
});

// GET /wiki/lint-log — 過去の Lint 実行履歴(created_at 降順・WIK-07)。
knowledgeLintRoutes.get("/wiki/lint-log", async (c) => {
  const runs = (await store(c).listEvents(`truth/${WIKI_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.level === "lint_log")
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(a.node_id).localeCompare(String(b.node_id)));
  return c.json({ runs });
});
