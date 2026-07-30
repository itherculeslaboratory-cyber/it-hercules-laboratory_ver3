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
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify([
          { number: 1, title: "改善案A", body: "b", labels: [{ name: "improvement" }], html_url: "https://x/1" },
          { number: 2, title: "PR", body: "", labels: [], html_url: "https://x/2", pull_request: {} },
        ]),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const view = await projectGithubActivity({}, "owner/repo");
    expect(view.error).toBeUndefined();
    expect(view.issues).toHaveLength(1);
    expect(view.issues[0]).toMatchObject({ number: 1, title: "改善案A", labels: ["improvement"] });
  });

  it("projectGithubActivity is best-effort on network failure (empty issues + error, does not throw)", async () => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    const view = await projectGithubActivity({}, "owner/repo");
    expect(view.issues).toEqual([]);
    expect(view.error).toBeTruthy();
  });

  it("GET /plaza/github/activity requires repo (400 REPO_REQUIRED)", async () => {
    const res = await app.request("/api/v1/plaza/github/activity", {}, makeEnv());
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "REPO_REQUIRED" });
  });

  it("GET /plaza/github/activity?repo=... returns the issues view", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })) as unknown as typeof fetch;
    const res = await app.request("/api/v1/plaza/github/activity?repo=owner/repo", {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { repo: string; issues: unknown[] };
    expect(body.repo).toBe("owner/repo");
    expect(body.issues).toEqual([]);
  });
});
