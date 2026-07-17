// GitHub Issues 読み取りコネクタ(V3-AIP-67・薄いコネクタ)。payjp-connector.ts/
// gmo-connector.ts と同じ接続層分離パターン: DI ファクトリ + 防御的パース。
// GitHub の public repo Issues 一覧は無認証でも読める(レート制限は低いのみ)ため、
// PAYJP_SECRET_KEY のような必須シークレットは無い — GITHUB_TOKEN は任意(レート緩和用)。
// 実値はいずれも env 経由のみ(実値の読み取り・出力・コミット禁止・AGENTS.md 禁止事項)。
export interface GithubIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  html_url: string;
}

export interface GithubIssuesConnector {
  /** labels のいずれかを持つ issue 一覧(state=open 既定)。 */
  listIssues(repo: string, labels: string[]): Promise<GithubIssue[]>;
}

export interface GithubIssuesEnv {
  GITHUB_API_BASE?: string;
  // 任意。無くても public repo は動く(unauthenticated レート制限内)。
  GITHUB_TOKEN?: string;
}

const DEFAULT_API_BASE = "https://api.github.com";

/** GitHub API の生 issue オブジェクト → GithubIssue へ防御的パース。不正形状は null。 */
export function parseIssue(raw: unknown): GithubIssue | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o.number !== "number" || typeof o.title !== "string") return null;
  // GitHub は pull request も /issues に混ぜて返す — pull_request キーの有無で除外。
  if ("pull_request" in o) return null;
  const rawLabels = Array.isArray(o.labels) ? o.labels : [];
  const labels = rawLabels
    .map((l) => (typeof l === "string" ? l : typeof (l as { name?: unknown })?.name === "string" ? (l as { name: string }).name : null))
    .filter((l): l is string => l !== null);
  return {
    number: o.number,
    title: o.title,
    body: typeof o.body === "string" ? o.body : "",
    labels,
    html_url: typeof o.html_url === "string" ? o.html_url : "",
  };
}

export function makeGithubIssuesConnector(env: GithubIssuesEnv): GithubIssuesConnector {
  const base = env.GITHUB_API_BASE ?? DEFAULT_API_BASE;
  return {
    async listIssues(repo: string, labels: string[]): Promise<GithubIssue[]> {
      const qs = new URLSearchParams({ state: "open", per_page: "100" });
      if (labels.length) qs.set("labels", labels.join(","));
      const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
      if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
      const res = await fetch(`${base}/repos/${repo}/issues?${qs.toString()}`, { headers });
      if (!res.ok) throw new Error(`github issues HTTP ${res.status}`);
      const json = await res.json();
      return (Array.isArray(json) ? json : []).map(parseIssue).filter((i): i is GithubIssue => i !== null);
    },
  };
}
