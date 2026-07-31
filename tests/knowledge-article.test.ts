// V3-AIP-102 — 技術記事投稿パック(コピペ完結・サイト別フォーマット)。
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { knowledgeArticleRoutes, buildArticlePack, ARTICLE_SITE_KINDS } from "../apps/api/src/knowledge-article-routes";
import { makeEnv } from "./helpers";

const app = new Hono<{ Bindings: ReturnType<typeof makeEnv> }>();
app.route("/api/v1", knowledgeArticleRoutes);

describe("V3-AIP-102 buildArticlePack (pure fn)", () => {
  it("generates one entry per site by default (all ARTICLE_SITE_KINDS)", () => {
    const pack = buildArticlePack({ title: "システム案", body: "本文です。", tags: ["ihl", "governance"] });
    expect(pack.map((p) => p.site)).toEqual([...ARTICLE_SITE_KINDS]);
  });

  it("zenn entry has frontmatter with published:false (public gate stays human)", () => {
    const [zenn] = buildArticlePack({ title: "T", body: "B" }, ["zenn"]);
    expect(zenn.text).toContain("published: false");
    expect(zenn.text).toContain('title: "T"');
    expect(zenn.text).toContain("B");
  });

  it("qiita entry includes a Tags line only when tags are given", () => {
    const [withTags] = buildArticlePack({ title: "T", body: "B", tags: ["a", "b"] }, ["qiita"]);
    expect(withTags.text).toContain("Tags: a, b");
    const [noTags] = buildArticlePack({ title: "T", body: "B" }, ["qiita"]);
    expect(noTags.text).not.toContain("Tags:");
  });

  it("does not alter body content (no summarization/rewrite — LLM既定OFF)", () => {
    const body = "元の文章はそのまま。改変しない。";
    for (const site of ARTICLE_SITE_KINDS) {
      const [entry] = buildArticlePack({ title: "T", body }, [site]);
      expect(entry.text).toContain(body);
    }
  });

  it("sites param restricts the generated set", () => {
    const pack = buildArticlePack({ title: "T", body: "B" }, ["note", "hatena"]);
    expect(pack.map((p) => p.site)).toEqual(["note", "hatena"]);
  });
});

describe("POST /knowledge/article-pack", () => {
  it("400 when title or body missing", async () => {
    const res = await app.request(
      "/api/v1/knowledge/article-pack",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "T" }) },
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("400 when sites contains an unknown site key", async () => {
    const res = await app.request(
      "/api/v1/knowledge/article-pack",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "T", body: "B", sites: ["zenn", "not-a-site"] }) },
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("201-equivalent 200: returns a pack for all sites by default", async () => {
    const res = await app.request(
      "/api/v1/knowledge/article-pack",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "システム案", body: "本文" }) },
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string; sites: string[]; pack: { site: string; text: string }[] };
    expect(body.title).toBe("システム案");
    expect(body.sites).toEqual([...ARTICLE_SITE_KINDS]);
    expect(body.pack).toHaveLength(ARTICLE_SITE_KINDS.length);
  });
});
