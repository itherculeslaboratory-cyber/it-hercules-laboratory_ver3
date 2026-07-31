// V3-BBS-38 — GitHub統合はAPI連携(読み取り)を原則とする。柱3(GitHub掲示板)表示データ。
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { plazaGithubRoutes, projectGithubActivity } from "../apps/api/src/plaza-github-routes";
import { makeEnv } from "./helpers";

const app = new Hono<{ Bindings: ReturnType<typeof makeEnv> }>();
app.route("/api/v1", plazaGithubRoutes);

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("V3-BBS-38 GitHub read integration (Issues)", () => {
  it("projectGithubActivity returns parsed issues on success (pull_request excluded)", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/issues")) {
        return new Response(
          JSON.stringify([
            { number: 1, title: "改善案A", body: "b", labels: [{ name: "improvement" }], html_url: "https://x/1" },
            { number: 2, title: "PR", body: "", labels: [], html_url: "https://x/2", pull_request: {} },
          ]),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof fetch;
    const view = await projectGithubActivity({}, "owner/repo");
    expect(view.errors).toEqual([]);
    expect(view.issues).toHaveLength(1);
    expect(view.issues[0]).toMatchObject({ number: 1, title: "改善案A", labels: ["improvement"] });
  });

  it("projectGithubActivity is best-effort on network failure (empty lists + errors[], does not throw)", async () => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    const view = await projectGithubActivity({}, "owner/repo");
    expect(view.issues).toEqual([]);
    expect(view.pulls).toEqual([]);
    expect(view.commits).toEqual([]);
    expect(view.releases).toEqual([]);
    expect(view.errors.length).toBe(4);
  });

  it("V3-BBS-38(2026-08-01追加) — PR/commits/Releasesを取得してビューへ含める", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/pulls")) {
        return new Response(
          JSON.stringify([{ number: 10, title: "PR-A", body: "", state: "open", html_url: "https://x/pr/10", merged_at: null }]),
          { status: 200 },
        );
      }
      if (url.includes("/commits")) {
        return new Response(
          JSON.stringify([{ sha: "abc123", commit: { message: "fix: x", author: { name: "alice" } }, html_url: "https://x/c/abc123" }]),
          { status: 200 },
        );
      }
      if (url.includes("/releases")) {
        return new Response(
          JSON.stringify([{ tag_name: "v1.0.0", name: "v1.0.0", body: "notes", html_url: "https://x/r/v1", published_at: "2026-08-01T00:00:00Z" }]),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof fetch;
    const view = await projectGithubActivity({}, "owner/repo");
    expect(view.errors).toEqual([]);
    expect(view.pulls).toEqual([{ number: 10, title: "PR-A", body: "", state: "open", html_url: "https://x/pr/10", merged: false }]);
    expect(view.commits).toEqual([{ sha: "abc123", message: "fix: x", author: "alice", html_url: "https://x/c/abc123" }]);
    expect(view.releases).toEqual([
      { tag_name: "v1.0.0", name: "v1.0.0", body: "notes", html_url: "https://x/r/v1", published_at: "2026-08-01T00:00:00Z" },
    ]);
  });

  it("GET /plaza/github/activity requires repo (400 REPO_REQUIRED)", async () => {
    const res = await app.request("/api/v1/plaza/github/activity", {}, makeEnv());
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "REPO_REQUIRED" });
  });

  it("GET /plaza/github/activity?repo=... returns the merged view (issues/pulls/commits/releases)", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })) as unknown as typeof fetch;
    const res = await app.request("/api/v1/plaza/github/activity?repo=owner/repo", {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { repo: string; issues: unknown[]; pulls: unknown[]; commits: unknown[]; releases: unknown[] };
    expect(body.repo).toBe("owner/repo");
    expect(body.issues).toEqual([]);
    expect(body.pulls).toEqual([]);
    expect(body.commits).toEqual([]);
    expect(body.releases).toEqual([]);
  });
});
