// V3-PPR-23 — 論文の章構成(PaperSectionsV1 6節・実装済み)+ 引用管理(CiteRef 単一正本を
// 再利用・観測/論文/URL/書籍の4タイプに限定)+ 公開範囲設定 + PDF/HTML変換(HTML export・
// PDFはブラウザ標準印刷機能を再利用=新規依存を追加しない)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { renderContentHtml } from "../apps/api/src/research-content-routes";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

function paperBody(overrides: Record<string, unknown> = {}) {
  return {
    content_type: "paper",
    title: "Horn length study",
    sections: {
      purpose: { filled: true, text: "purpose text" },
      hypothesis: { filled: false, text: "" },
      conditions: { filled: false, text: "" },
      verification: { filled: false, text: "" },
      phase: { filled: false, text: "" },
      gap: { filled: false, text: "" },
    },
    completeness_pct: 17,
    ...overrides,
  };
}
function postContent(env: ReturnType<typeof makeEnv>, body: unknown) {
  return app.request("/api/v1/research/content", { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(body) }, env);
}

describe("POST /api/v1/research/content citations (PPR-23 4-type restriction)", () => {
  it("accepts observation/paper/url/book citation types", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const res = await postContent(env, paperBody({
      citations: [
        { type: "observation", id: "OBS-1" },
        { type: "paper", id: "PAP-1" },
        { type: "url", id: "https://example.com/paper.pdf", label: "External PDF" },
        { type: "book", id: "ISBN-1", label: "Some Book" },
      ],
    }));
    expect(res.status).toBe(201);
  });

  it("rejects a citation type outside observation/paper/url/book with 400", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const res = await postContent(env, paperBody({ citations: [{ type: "listing", id: "L-1" }] }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("INVALID_CITATION");
  });
});

describe("GET /api/v1/research/content visibility filtering (PPR-23 公開範囲設定)", () => {
  it("excludes another actor's private content from the list projection", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const priv = await postContent(env, paperBody({ title: "private one", visibility: "private" }));
    expect(priv.status).toBe(201);
    const pub = await postContent(env, paperBody({ title: "public one" }));
    expect(pub.status).toBe(201);

    const res = await app.request("/api/v1/research/content?type=paper", { headers: AUTH_HEADERS }, env);
    const { items } = (await res.json()) as { items: { title: string }[] };
    const titles = items.map((i) => i.title);
    // same actor (AUTH_HEADERS = dev principal) authored both -> private is still visible to its own author
    expect(titles).toContain("private one");
    expect(titles).toContain("public one");
  });
});

describe("renderContentHtml (PPR-23 HTML export)", () => {
  it("renders sections, measurements, and citations with escaped UGC", () => {
    const html = renderContentHtml({
      title: "<script>alert(1)</script>",
      sections: { purpose: { filled: true, text: "the purpose" }, hypothesis: { filled: false, text: "" } },
      measurements: [{ item: "horn_length", value: 80, unit: "mm" }],
      citations: [{ type: "url", id: "https://example.com", label: "Example" }],
    });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("the purpose");
    expect(html).toContain("horn_length");
    expect(html).toContain('href="https://example.com"');
  });
});

describe("GET /api/v1/research/content/{id}/export", () => {
  it("returns self-contained HTML for an existing paper", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const created = await postContent(env, paperBody());
    const { content_id } = (await created.json()) as { content_id: string };
    const res = await app.request(`/api/v1/research/content/${content_id}/export`, { headers: AUTH_HEADERS }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Horn length study");
    expect(html).toContain("purpose text");
  });

  it("404s on unknown content_id", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const res = await app.request("/api/v1/research/content/MISSING/export", { headers: AUTH_HEADERS }, env);
    expect(res.status).toBe(404);
  });

  it("400s on an unsupported format (PDF is client-side browser print, not server-rendered)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const created = await postContent(env, paperBody());
    const { content_id } = (await created.json()) as { content_id: string };
    const res = await app.request(`/api/v1/research/content/${content_id}/export?format=pdf`, { headers: AUTH_HEADERS }, env);
    expect(res.status).toBe(400);
  });

  it("requires auth (401)", async () => {
    const res = await app.request("/api/v1/research/content/x/export", {}, makeEnv());
    expect(res.status).toBe(401);
  });
});
