// V3-BBS-38 — GitHub統合は画面遷移(外部リンク)ではなくAPI連携を原則とする。知の広場
// 柱3(GitHub掲示板)は GitHub API の読み取り+IHL内表示に置換する。書き込み系(Issue起票等)
// は第2波・書き込み用トークン投入は人間ゲート(このrouteは読み取り専用)。
// 既存 github-issues-connector.ts(V3-AIP-67・Issues読取コネクタ・w1-mkt所有)を読み取り
// importで再利用するだけで、新規コネクタ/新規外部呼び出しは作らない(reuse-first)。
// PR/commits/Releases の読取は github-issues-connector.ts 側の拡張が要る(本艦のglob外・
// w1-mkt担当)ため、現時点は Issues のみ(報告書「持ち越し」参照)。
import { Hono } from "hono";
import type { Bindings, Variables } from "./env";
import { makeGithubIssuesConnector, type GithubIssue } from "./github-issues-connector";

export const plazaGithubRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

export interface GithubActivityView {
  repo: string;
  issues: GithubIssue[];
  error?: string;
}

/**
 * projectGithubActivity — 柱3(GitHub掲示板)のIHL内表示用データ(BBS-38)。ネットワーク
 * 失敗は best-effort(空配列+error同梱・全体を落とさない=repo未存在/レート制限でも
 * 知の広場自体は表示できる)。
 */
export async function projectGithubActivity(
  env: { GITHUB_API_BASE?: string; GITHUB_TOKEN?: string },
  repo: string,
  labels: string[] = [],
): Promise<GithubActivityView> {
  const connector = makeGithubIssuesConnector(env);
  try {
    const issues = await connector.listIssues(repo, labels);
    return { repo, issues };
  } catch (e) {
    return { repo, issues: [], error: e instanceof Error ? e.message : "unknown" };
  }
}

// GET /plaza/github/activity?repo=<owner/name>&labels=a,b — 柱3表示データ(BBS-38)。
plazaGithubRoutes.get("/plaza/github/activity", async (c) => {
  const repo = c.req.query("repo");
  if (!repo) return c.json({ error: "REPO_REQUIRED" }, 400);
  const labels = (c.req.query("labels") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const view = await projectGithubActivity(c.env as { GITHUB_API_BASE?: string; GITHUB_TOKEN?: string }, repo, labels);
  return c.json(view);
});
