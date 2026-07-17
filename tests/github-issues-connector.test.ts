// V3-AIP-67: GitHub Issues 読み取りコネクタの防御的パース。実 GitHub API への疎通は
// しない(fetch を注入するテストのみ・secrets 不要 — public repo 読み取りは無認証で可)。
import { describe, expect, it, vi, afterEach } from "vitest";
import { makeGithubIssuesConnector, parseIssue } from "../apps/api/src/github-issues-connector";

describe("parseIssue(GitHub API 生 issue の防御的パース)", () => {
  it("正常な issue を抽出し labels は文字列配列に正規化", () => {
    const raw = {
      number: 42,
      title: "テンプレの穴埋めが遅い",
      body: "詳細本文",
      labels: [{ name: "improvement" }, "bug"],
      html_url: "https://github.com/x/y/issues/42",
    };
    expect(parseIssue(raw)).toEqual({
      number: 42,
      title: "テンプレの穴埋めが遅い",
      body: "詳細本文",
      labels: ["improvement", "bug"],
      html_url: "https://github.com/x/y/issues/42",
    });
  });

  it("pull_request キーを持つものは issue でないため null(GitHub API は PR も /issues に混ぜる)", () => {
    expect(parseIssue({ number: 1, title: "x", pull_request: { url: "..." } })).toBeNull();
  });

  it("number/title 欠如・null は null", () => {
    expect(parseIssue({ title: "no number" })).toBeNull();
    expect(parseIssue({ number: 1 })).toBeNull();
    expect(parseIssue(null)).toBeNull();
  });

  it("body/labels/html_url 欠如は安全な既定値", () => {
    expect(parseIssue({ number: 5, title: "t" })).toEqual({
      number: 5,
      title: "t",
      body: "",
      labels: [],
      html_url: "",
    });
  });
});

describe("makeGithubIssuesConnector(labels フィルタ + fetch 注入)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("repo/labels を GitHub API クエリに反映し、非-PR issue のみ返す", async () => {
    let seenUrl = "";
    let seenAuth: string | undefined;
    globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      seenUrl = String(url);
      seenAuth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      return new Response(
        JSON.stringify([
          { number: 1, title: "issue A", labels: ["bug"], html_url: "u1" },
          { number: 2, title: "PR not an issue", pull_request: {} },
        ]),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const connector = makeGithubIssuesConnector({ GITHUB_TOKEN: "gh_test_token" });
    const issues = await connector.listIssues("owner/repo", ["bug", "improvement"]);

    expect(issues).toEqual([{ number: 1, title: "issue A", body: "", labels: ["bug"], html_url: "u1" }]);
    expect(seenUrl).toContain("/repos/owner/repo/issues");
    expect(seenUrl).toContain("labels=bug%2Cimprovement");
    expect(seenAuth).toBe("Bearer gh_test_token");
  });

  it("GITHUB_TOKEN 未設定でも Authorization ヘッダを付けない(public repo は無認証で可)", async () => {
    let seenAuth: string | undefined = "unset";
    globalThis.fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      seenAuth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      return new Response("[]", { status: 200 });
    }) as unknown as typeof fetch;

    await makeGithubIssuesConnector({}).listIssues("owner/repo", []);
    expect(seenAuth).toBeUndefined();
  });

  it("HTTP エラーは throw(fetch 失敗を握りつぶさない)", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    await expect(makeGithubIssuesConnector({}).listIssues("owner/repo", [])).rejects.toThrow(/github issues HTTP 503/);
  });
});
