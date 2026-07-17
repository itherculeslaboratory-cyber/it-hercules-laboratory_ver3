// V3-AIP-67: GitHub Issues/掲示板 → AI 要約スレ。
//   - requireRole(operator/admin) で fail-closed(gov-flag.test.ts と同型)。
//   - 既存 ai-kernel LLMClient の DI seam を再利用(fnd-21-ai-kernel.test.ts と同型)。
//     既定(AI_DISABLED)では要約を捏造せず posts_created=0 を返す(不変条項①)。
//   - 保存は新イベント型を増やさず ihl.plaza.post.v1(channel=knowledge-board・
//     board_kind=improvement)— 既存の知の広場 GET /plaza/channels/.../threads で
//     無改造表示されることを実際に叩いて検証する。
//   - 同一 issue の再要約は INSERT ONLY で新バージョンを追記(correction_of で連結)。
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { TruthStore } from "@ihl/truth";
import app from "../apps/api/src/index";
import { createAiDigestRoutes, extractKeywords } from "../apps/api/src/ai-digest-routes";
import { plazaRoutes, projectThread } from "../apps/api/src/plaza-routes";
import type { GithubIssue, GithubIssuesConnector } from "../apps/api/src/github-issues-connector";
import type { LLMClient } from "../apps/api/src/ai-kernel";
import { AiDisabledError } from "../apps/api/src/ai-kernel";
import type { Bindings, Variables } from "../apps/api/src/env";
import { issueSessionToken } from "../apps/api/src/session";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

const JSON_HEADERS = { "content-type": "application/json" };

function fakeConnector(issues: GithubIssue[]): GithubIssuesConnector {
  return { listIssues: async () => issues };
}
function fakeEnabledClient(reply: (n: number) => string): LLMClient {
  let n = 0;
  return { complete: async () => ({ text: reply(++n) }) };
}
const disabledClient: LLMClient = {
  complete: async () => {
    throw new AiDisabledError();
  },
};

// roles を固定 set した最小アプリ(authz.test.ts appWithRoles と同型) + plaza の表示 route も
// 同一 store 前提で並べて叩けるように同居させる。
function mount(
  connector: GithubIssuesConnector,
  client: LLMClient,
  roles: string[] = ["operator"],
) {
  const a = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  a.use("*", async (c, next) => {
    c.set("roles", roles);
    c.set("actorId", "tester");
    return next();
  });
  a.route("/api/v1", createAiDigestRoutes(() => client, () => connector));
  a.route("/api/v1", plazaRoutes);
  return a;
}

function issue(n: number, title = `issue ${n}`, labels: string[] = ["improvement"]): GithubIssue {
  return { number: n, title, body: "body", labels, html_url: `https://x/${n}` };
}

describe("V3-AIP-67 requireRole ゲート(fail-closed)", () => {
  it("未認証 → 401 AUTH_REQUIRED(実 app・route-matrix 契約と同型)", async () => {
    const res = await app.request("/api/v1/ai-digest/sync", { method: "POST" }, makeEnv());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "AUTH_REQUIRED" });
  });

  it("operator/admin 以外(平会員 roles=['member']) → 403", async () => {
    const tok = await issueSessionToken("member-1", SESSION_SECRET, ["member"]);
    const res = await app.request(
      "/api/v1/ai-digest/sync",
      { method: "POST", headers: { Authorization: `Bearer ${tok}` } },
      makeEnv(),
    );
    expect(res.status).toBe(403);
  });
});

describe("V3-AIP-67 extractKeywords(捏造しない・無ければ空配列)", () => {
  it("keywords: 行を抽出", () => {
    expect(extractKeywords("summary line\nkeywords: alpha, beta ,gamma")).toEqual(["alpha", "beta", "gamma"]);
  });
  it("日本語キーワード:行にも対応", () => {
    expect(extractKeywords("要約\nキーワード:虫, 血統")).toEqual(["虫", "血統"]);
  });
  it("該当行が無ければ空配列(でっち上げない)", () => {
    expect(extractKeywords("summary only, no keyword line")).toEqual([]);
  });
});

describe("V3-AIP-67 AI 既定 OFF(BYOK 未設定)— 捏造せず 0 件応答", () => {
  it("issue は fetch するが要約は作らず posts_created=0・ai_disabled=true", async () => {
    const bucket = new FakeR2Bucket();
    const a = mount(fakeConnector([issue(1), issue(2)]), disabledClient);
    const res = await a.request(
      "/api/v1/ai-digest/sync",
      { method: "POST", headers: JSON_HEADERS },
      makeEnv(bucket),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fetched).toBe(2);
    expect(body.summarized).toBe(0);
    expect(body.posts_created).toBe(0);
    expect(body.ai_disabled).toBe(true);
    const keys = [...bucket.objects.keys()].filter((k) => k.startsWith("truth/ihl.plaza.post.v1/"));
    expect(keys.length).toBe(0);
  });
});

describe("V3-AIP-67 AI 有効時: 要約 → 掲示板(改善の板)へ INSERT ONLY 保存 + 表示", () => {
  it("2 issue を要約して knowledge-board/improvement へ 2 スレ作成し、既存の掲示板 GET でそのまま見える", async () => {
    const bucket = new FakeR2Bucket();
    const client = fakeEnabledClient((n) => `3行要約その${n}\nkeywords: tag${n}`);
    const a = mount(fakeConnector([issue(101, "テンプレ穴埋めが遅い"), issue(102, "画像が表示されない")]), client);

    const res = await a.request("/api/v1/ai-digest/sync", { method: "POST", headers: JSON_HEADERS }, makeEnv(bucket));
    const body = await res.json();
    expect(body).toEqual({ repo: body.repo, fetched: 2, considered: 2, summarized: 2, posts_created: 2, ai_disabled: false });

    // 既存の知の広場 board route(改造なし)がそのまま拾う。
    const board = await a.request(
      "/api/v1/plaza/channels/knowledge-board/threads",
      { headers: JSON_HEADERS },
      makeEnv(bucket),
    );
    const boardBody = await board.json();
    const improvementThreads = boardBody.boards.improvement;
    expect(improvementThreads.map((t: { topic: string }) => t.topic).sort()).toEqual([
      "テンプレ穴埋めが遅い",
      "画像が表示されない",
    ]);

    // 1 issue 分のスレを詳細確認: body/tags/actor_id。
    const thread = await projectThread(new TruthStore(bucket), "gh-issue-101");
    expect(thread?.posts.length).toBe(1);
    expect(thread?.posts[0].body).toContain("3行要約その1");
    expect(thread?.posts[0].tags).toEqual(expect.arrayContaining(["improvement", "gh-issue-101", "v1", "tag1"]));
    expect(thread?.posts[0].actor_id).toBe("system:ai-digest");
  });

  it("同一 issue の再 sync は新バージョンを INSERT ONLY 追記(correction_of で連結・上書きしない)", async () => {
    const bucket = new FakeR2Bucket();
    const a1 = mount(fakeConnector([issue(7)]), fakeEnabledClient(() => "v1 summary"));
    await a1.request("/api/v1/ai-digest/sync", { method: "POST", headers: JSON_HEADERS }, makeEnv(bucket));

    const a2 = mount(fakeConnector([issue(7)]), fakeEnabledClient(() => "v2 summary(re-summarized)"));
    const res2 = await a2.request("/api/v1/ai-digest/sync", { method: "POST", headers: JSON_HEADERS }, makeEnv(bucket));
    expect((await res2.json()).posts_created).toBe(1);

    const thread = await projectThread(new TruthStore(bucket), "gh-issue-7");
    expect(thread?.posts.length).toBe(2); // 追記(両バージョン共存・上書きなし)
    const [p1, p2] = thread!.posts;
    expect(p1.body).toBe("v1 summary");
    expect(p1.tags).toEqual(expect.arrayContaining(["v1"]));
    expect(p2.body).toBe("v2 summary(re-summarized)");
    expect(p2.tags).toEqual(expect.arrayContaining(["v2"]));
    expect(p2.correction_of).toBe(p1.post_id); // 直前バージョンへ連結(削除ではなく追記)
  });

  it("config の batch_size を超える issue は打ち切る(100件蓄積の上限)", async () => {
    const bucket = new FakeR2Bucket();
    const many = Array.from({ length: 101 }, (_, i) => issue(i + 1));
    const a = mount(fakeConnector(many), fakeEnabledClient(() => "summary(no keywords)"));
    const res = await a.request("/api/v1/ai-digest/sync", { method: "POST", headers: JSON_HEADERS }, makeEnv(bucket));
    const body = await res.json();
    expect(body.fetched).toBe(101);
    expect(body.considered).toBe(100);
    expect(body.posts_created).toBe(100);
  });
});

describe("V3-AIP-67 GitHub fetch 障害は 502(未着手の要約を捏造しない)", () => {
  it("connector.listIssues が throw → 502 GITHUB_FETCH_FAILED", async () => {
    const failingConnector: GithubIssuesConnector = {
      listIssues: async () => {
        throw new Error("github issues HTTP 503");
      },
    };
    const a = mount(failingConnector, disabledClient);
    const res = await a.request("/api/v1/ai-digest/sync", { method: "POST", headers: JSON_HEADERS }, makeEnv());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "GITHUB_FETCH_FAILED" });
  });
});
