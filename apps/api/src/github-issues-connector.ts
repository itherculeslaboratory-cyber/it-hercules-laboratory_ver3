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

export interface GithubPull {
  number: number;
  title: string;
  body: string;
  state: string;
  html_url: string;
  merged: boolean;
}

export interface GithubCommit {
  sha: string;
  message: string;
  author: string;
  html_url: string;
}

export interface GithubRelease {
  tag_name: string;
  name: string;
  body: string;
  html_url: string;
  published_at: string;
}

export interface GithubIssuesConnector {
  /** labels のいずれかを持つ issue 一覧(state=open 既定)。 */
  listIssues(repo: string, labels: string[]): Promise<GithubIssue[]>;
  /** PR 一覧(state=open 既定・V3-BBS-38)。 */
  listPulls(repo: string): Promise<GithubPull[]>;
  /** default branch の直近コミット一覧(V3-BBS-38)。 */
  listCommits(repo: string): Promise<GithubCommit[]>;
  /** Releases 一覧(V3-BBS-38)。 */
  listReleases(repo: string): Promise<GithubRelease[]>;
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

/** GitHub API の生 PR オブジェクト → GithubPull へ防御的パース。不正形状は null。 */
export function parsePull(raw: unknown): GithubPull | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o.number !== "number" || typeof o.title !== "string") return null;
  return {
    number: o.number,
    title: o.title,
    body: typeof o.body === "string" ? o.body : "",
    state: typeof o.state === "string" ? o.state : "open",
    html_url: typeof o.html_url === "string" ? o.html_url : "",
    merged: (o.merged_at ?? null) !== null,
  };
}

/** GitHub API の生 commit オブジェクト → GithubCommit へ防御的パース。不正形状は null。 */
export function parseCommit(raw: unknown): GithubCommit | null {
  const o = raw as Record<string, unknown> | null;
  const sha = o && typeof o.sha === "string" ? o.sha : "";
  if (!sha) return null;
  const commit = (o!.commit ?? {}) as Record<string, unknown>;
  const author = (commit.author ?? {}) as Record<string, unknown>;
  return {
    sha,
    message: typeof commit.message === "string" ? commit.message : "",
    author: typeof author.name === "string" ? author.name : "",
    html_url: typeof o!.html_url === "string" ? (o!.html_url as string) : "",
  };
}

/** GitHub API の生 release オブジェクト → GithubRelease へ防御的パース。不正形状は null。 */
export function parseRelease(raw: unknown): GithubRelease | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o.tag_name !== "string") return null;
  return {
    tag_name: o.tag_name,
    name: typeof o.name === "string" ? o.name : o.tag_name,
    body: typeof o.body === "string" ? o.body : "",
    html_url: typeof o.html_url === "string" ? o.html_url : "",
    published_at: typeof o.published_at === "string" ? o.published_at : "",
  };
}

export function makeGithubIssuesConnector(env: GithubIssuesEnv): GithubIssuesConnector {
  const base = env.GITHUB_API_BASE ?? DEFAULT_API_BASE;
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;

  async function getJson(path: string, errLabel: string): Promise<unknown> {
    const res = await fetch(`${base}${path}`, { headers });
    if (!res.ok) throw new Error(`github ${errLabel} HTTP ${res.status}`);
    return res.json();
  }

  return {
    async listIssues(repo: string, labels: string[]): Promise<GithubIssue[]> {
      const qs = new URLSearchParams({ state: "open", per_page: "100" });
      if (labels.length) qs.set("labels", labels.join(","));
      const json = await getJson(`/repos/${repo}/issues?${qs.toString()}`, "issues");
      return (Array.isArray(json) ? json : []).map(parseIssue).filter((i): i is GithubIssue => i !== null);
    },
    async listPulls(repo: string): Promise<GithubPull[]> {
      const qs = new URLSearchParams({ state: "open", per_page: "100" });
      const json = await getJson(`/repos/${repo}/pulls?${qs.toString()}`, "pulls");
      return (Array.isArray(json) ? json : []).map(parsePull).filter((p): p is GithubPull => p !== null);
    },
    async listCommits(repo: string): Promise<GithubCommit[]> {
      const qs = new URLSearchParams({ per_page: "30" });
      const json = await getJson(`/repos/${repo}/commits?${qs.toString()}`, "commits");
      return (Array.isArray(json) ? json : []).map(parseCommit).filter((c): c is GithubCommit => c !== null);
    },
    async listReleases(repo: string): Promise<GithubRelease[]> {
      const qs = new URLSearchParams({ per_page: "30" });
      const json = await getJson(`/repos/${repo}/releases?${qs.toString()}`, "releases");
      return (Array.isArray(json) ? json : []).map(parseRelease).filter((r): r is GithubRelease => r !== null);
    },
  };
}
