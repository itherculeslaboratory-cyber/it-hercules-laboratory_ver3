// V3-BBS-38 — GitHub統合は画面遷移(外部リンク)ではなくAPI連携を原則とする。知の広場
// 柱3(GitHub掲示板)は GitHub API の読み取り+IHL内表示に置換する。書き込み系(Issue起票等)
// は第2波・書き込み用トークン投入は人間ゲート(このrouteは読み取り専用)。
// 既存 github-issues-connector.ts(V3-AIP-67・Issues読取コネクタ)を読み取りimportで
// 再利用するだけで、新規コネクタ/新規外部呼び出しは作らない(reuse-first)。
// [2026-08-01 w-plaza2追記] PR/commits/Releases の読取メソッド(listPulls/listCommits/
// listReleases)は橋渡し波2(R0731-7b0c89)で github-issues-connector.ts 側に既に追加済み
// だったため、ここではそれを呼び出す配線のみを行う(コネクタ拡張は今回不要)。
import { Hono } from "hono";
import type { Bindings, Variables } from "./env";
import {
  makeGithubIssuesConnector,
  type GithubIssue,
  type GithubPull,
  type GithubCommit,
  type GithubRelease,
} from "./github-issues-connector";

export const plazaGithubRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

export interface GithubActivityView {
  repo: string;
  issues: GithubIssue[];
  pulls: GithubPull[];
  commits: GithubCommit[];
  releases: GithubRelease[];
  errors: string[]; // best-effort: 個別呼び出しの失敗理由(呼び出し種別ごと)。空配列=全成功。
}

/**
 * projectGithubActivity — 柱3(GitHub掲示板)のIHL内表示用データ(BBS-38)。Issues/PR/
 * commits/Releases の4種を並行取得し、種別ごとに best-effort(1種の失敗が他を道連れに
 * しない=repo未存在/レート制限でも知の広場自体は表示できる)。旧 `error?: string`(単数)
 * から `errors: string[]` へ変更(4種のうち複数が同時に失敗しうるため・破壊的変更だが
 * このrouteの呼び出し元はplaza側のみでUI未接続=影響範囲は本ラウンドのテストのみ)。
 */
export async function projectGithubActivity(
  env: { GITHUB_API_BASE?: string; GITHUB_TOKEN?: string },
  repo: string,
  labels: string[] = [],
): Promise<GithubActivityView> {
  const connector = makeGithubIssuesConnector(env);
  const errors: string[] = [];

  const [issues, pulls, commits, releases] = await Promise.all([
    connector.listIssues(repo, labels).catch((e) => {
      errors.push(`issues: ${e instanceof Error ? e.message : "unknown"}`);
      return [] as GithubIssue[];
    }),
    connector.listPulls(repo).catch((e) => {
      errors.push(`pulls: ${e instanceof Error ? e.message : "unknown"}`);
      return [] as GithubPull[];
    }),
    connector.listCommits(repo).catch((e) => {
      errors.push(`commits: ${e instanceof Error ? e.message : "unknown"}`);
      return [] as GithubCommit[];
    }),
    connector.listReleases(repo).catch((e) => {
      errors.push(`releases: ${e instanceof Error ? e.message : "unknown"}`);
      return [] as GithubRelease[];
    }),
  ]);

  return { repo, issues, pulls, commits, releases, errors };
}

// GET /plaza/github/activity?repo=<owner/name>&labels=a,b — 柱3表示データ(BBS-38・
// Issues/PR/commits/Releasesの4種)。
plazaGithubRoutes.get("/plaza/github/activity", async (c) => {
  const repo = c.req.query("repo");
  if (!repo) return c.json({ error: "REPO_REQUIRED" }, 400);
  const labels = (c.req.query("labels") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const view = await projectGithubActivity(c.env as { GITHUB_API_BASE?: string; GITHUB_TOKEN?: string }, repo, labels);
  return c.json(view);
});
