// CiteRef TC(design-c5.md §K6 §4 / V3-BBS-20)。cite_refs[] が正本で本文の [ihl:cite] トークンは
// 従属(統合はするが重複は増やさない)・citeUrl が全 CiteRef type で安定 URL を返す。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { ulid } from "@ihl/truth";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";
import { citeUrl, parseCiteTokens, mergeCiteRefs, sha256Hex } from "../apps/api/src/plaza-routes";

const CITE_TYPES = [
  "observation", "individual", "paper", "thread", "post",
  "user", "tag", "listing", "precedent", "fork",
] as const;

function post(env: ReturnType<typeof makeEnv>, body: unknown) {
  return app.request("/api/v1/plaza/posts", { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(body) }, env);
}

describe("cite_refs is canonical and [ihl:cite] tokens are subordinate (BBS-20)", () => {
  it("merges body tokens into cite_refs while keeping the explicit refs canonical", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const id = ulid(1000);
    await post(env, {
      channel: "knowledge-board",
      topic: "citations",
      board_kind: "guide",
      thread_id: id,
      post_id: id,
      body: "see [ihl:cite type=fork id=F1] and also [ihl:cite type=post id=P1]",
      cite_refs: [{ type: "post", id: "P1", label: "canonical P1" }],
    });
    const detail = (await (await app.request(`/api/v1/plaza/posts/${id}`, { headers: AUTH_HEADERS }, env)).json()) as {
      post: { cite_refs: { type: string; id: string; label?: string }[] };
    };
    const refs = detail.post.cite_refs;
    // explicit P1 kept verbatim (label preserved), token duplicate NOT re-added
    const p1s = refs.filter((r) => r.type === "post" && r.id === "P1");
    expect(p1s).toHaveLength(1);
    expect(p1s[0].label).toBe("canonical P1");
    // token-only fork ref is merged in
    expect(refs.some((r) => r.type === "fork" && r.id === "F1")).toBe(true);
  });

  it("parseCiteTokens extracts every token and mergeCiteRefs de-duplicates against explicit refs", () => {
    const tokens = parseCiteTokens("a [ihl:cite type=post id=P1] b [ihl:cite type=tag id=T9]");
    expect(tokens).toEqual([
      { type: "post", id: "P1" },
      { type: "tag", id: "T9" },
    ]);
    const merged = mergeCiteRefs([{ type: "post", id: "P1" }], tokens);
    expect(merged).toEqual([
      { type: "post", id: "P1" },
      { type: "tag", id: "T9" },
    ]);
  });

  it("citeUrl returns a stable, distinct, absolute URL for every CiteRef type", () => {
    const urls = CITE_TYPES.map((type) => citeUrl({ type, id: "X-1" }));
    for (const u of urls) expect(u.startsWith("/")).toBe(true);
    // stable: encodes the id and is distinct per type
    expect(new Set(urls).size).toBe(CITE_TYPES.length);
    // deterministic — same input, same output
    expect(citeUrl({ type: "post", id: "X-1" })).toBe(citeUrl({ type: "post", id: "X-1" }));
  });

  it("sha256Hex is deterministic and change-sensitive", async () => {
    const a = await sha256Hex("content-v1");
    expect(a).toBe(await sha256Hex("content-v1"));
    expect(a).not.toBe(await sha256Hex("content-v2"));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
