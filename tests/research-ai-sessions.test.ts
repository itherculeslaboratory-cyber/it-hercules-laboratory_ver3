// V3-WIK-28 — Cursor 等の AI セッションログ(JSONL/markdown)を content(chat_log)へ
// 決定論正規化して取り込む(adaptGithubSource/external-import と同型・reuse-first)。常駐
// DB接続は行わない(呼び手=人間/ローカル手順書に従って抽出したテキストを渡すのみ・不変条項①)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { adaptAiSession } from "../apps/api/src/research-content-routes";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

const META = { source: "cursor", session_ref: "D:/repo/.cursor/chat/abc123" };

describe("adaptAiSession", () => {
  it("converts jsonl turns into role-labeled markdown lines", () => {
    const raw = [
      JSON.stringify({ role: "user", content: "観測データを整理して" }),
      JSON.stringify({ role: "assistant", content: "了解しました" }),
    ].join("\n");
    const r = adaptAiSession(META, "jsonl", raw);
    expect(r.body_markdown).toBe("**user**: 観測データを整理して\n\n**assistant**: 了解しました");
    expect(r.title).toBe("AIセッション: cursor/D:/repo/.cursor/chat/abc123");
    expect(r.system_tags).toEqual(["ai_session", "cursor"]);
  });

  it("skips unparsable/malformed lines instead of failing the whole session", () => {
    const raw = ["not json", JSON.stringify({ role: "user", content: "ok" }), JSON.stringify({ role: "user" })].join("\n");
    const r = adaptAiSession(META, "jsonl", raw);
    expect(r.body_markdown).toBe("**user**: ok");
  });

  it("passes markdown format through unchanged (minus LaTeX-forbidden chars)", () => {
    const r = adaptAiSession(META, "markdown", "body with \\ and $ signs");
    expect(r.body_markdown).toBe("body with  and  signs");
  });
});

describe("POST /api/v1/research/ai-sessions", () => {
  it("appends a chat_log content from a jsonl session", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const res = await app.request(
      "/api/v1/research/ai-sessions",
      {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({ ...META, format: "jsonl", raw: JSON.stringify({ role: "user", content: "hello" }) }),
      },
      env,
    );
    expect(res.status).toBe(201);
    const { content_id } = (await res.json()) as { content_id: string };

    const detail = await app.request(`/api/v1/research/content/${content_id}`, { headers: AUTH_HEADERS }, env);
    const data = (await detail.json()) as { content_type: string; body_markdown: string };
    expect(data.content_type).toBe("chat_log");
    expect(data.body_markdown).toBe("**user**: hello");

    const index = await app.request("/api/v1/research/chat-index", { headers: AUTH_HEADERS }, env);
    const { items } = (await index.json()) as { items: { content_id: string }[] };
    expect(items.map((i) => i.content_id)).toContain(content_id);
  });

  it("re-ingesting the same session (source+session_ref) 409s — idempotent, no duplicate", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const body = JSON.stringify({ ...META, format: "markdown", raw: "first pass" });
    const first = await app.request("/api/v1/research/ai-sessions", { method: "POST", headers: AUTH_HEADERS, body }, env);
    expect(first.status).toBe(201);
    const again = await app.request("/api/v1/research/ai-sessions", { method: "POST", headers: AUTH_HEADERS, body }, env);
    expect(again.status).toBe(409);
  });

  it("400s when required fields are missing", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const res = await app.request(
      "/api/v1/research/ai-sessions",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ source: "cursor" }) },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("requires auth (401)", async () => {
    const res = await app.request("/api/v1/research/ai-sessions", { method: "POST" }, makeEnv());
    expect(res.status).toBe(401);
  });
});
