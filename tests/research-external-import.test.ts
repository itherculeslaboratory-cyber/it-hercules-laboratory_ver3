// V3-WIK-29 — 論文/研究のために anthropics/life-sciences 等の外部知識(GitHub公開
// リポジトリ)を取り込む。アダプタ(adaptGithubSource)+手順書までを範囲とし、常駐フェッチは
// 行わない(呼び手が本文を供給・サーバは決定論正規化+append のみ・不変条項①)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { adaptGithubSource } from "../apps/api/src/research-content-routes";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

const META = { repo: "anthropics/life-sciences", path: "README.md", url: "https://github.com/anthropics/life-sciences/blob/main/README.md" };

describe("adaptGithubSource", () => {
  it("derives the title from the first markdown heading when present", () => {
    const r = adaptGithubSource(META, "# Life Sciences\n\nSome body text.");
    expect(r.title).toBe("Life Sciences");
    expect(r.body_markdown).toContain("Some body text.");
    expect(r.system_tags).toEqual(["external", "github", "anthropics/life-sciences"]);
    expect(r.citations).toEqual([{ type: "url", id: META.url, label: "anthropics/life-sciences" }]);
  });

  it("falls back to repo:path when there is no heading", () => {
    const r = adaptGithubSource(META, "no heading here");
    expect(r.title).toBe("anthropics/life-sciences: README.md");
  });

  it("strips LaTeX-forbidden characters (\\ and $) from title and body", () => {
    const r = adaptGithubSource(META, "# Cost is $5 and uses \\LaTeX\n\nbody with \\ and $");
    expect(r.title).not.toMatch(/[\\$]/);
    expect(r.body_markdown).not.toMatch(/[\\$]/);
  });
});

describe("POST /api/v1/research/external-import", () => {
  it("appends an article content with citations+system_tags derived from the adapter", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const res = await app.request(
      "/api/v1/research/external-import",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ ...META, markdown: "# Life Sciences\n\nbody" }) },
      env,
    );
    expect(res.status).toBe(201);
    const { content_id } = (await res.json()) as { content_id: string };

    const detail = await app.request(`/api/v1/research/content/${content_id}`, { headers: AUTH_HEADERS }, env);
    const data = (await detail.json()) as { content_type: string; title: string; citations: { type: string; id: string }[] };
    expect(data.content_type).toBe("article");
    expect(data.title).toBe("Life Sciences");
    expect(data.citations).toEqual([{ type: "url", id: META.url, label: "anthropics/life-sciences" }]);
  });

  it("400s when required fields are missing", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const res = await app.request(
      "/api/v1/research/external-import",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ repo: META.repo }) },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("requires auth (401)", async () => {
    const res = await app.request("/api/v1/research/external-import", { method: "POST" }, makeEnv());
    expect(res.status).toBe(401);
  });
});
