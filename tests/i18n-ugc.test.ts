// C5 K4 UGC 言語タグ TC(design-k4 §3 / V3-I18-06 part1)。market listing POST で
// description は原文のまま保存され、サーバ翻訳は走らない不変(保存 data.description ===
// 入力)。data.lang は actor の locale(projectPreferences・未設定は DEFAULT_LOCALE=ja)から
// 刻印される。前提: mkt-listing schema に lang 追加済(批評家修正1)で POST は 201・
// 既存 market テストは緑維持。
import { describe, expect, it } from "vitest";
import { ulid } from "@ihl/truth";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}
const authOf = async (actor: string) => bearer(await issueSessionToken(actor, SESSION_SECRET));
const postListing = (env: object, h: Record<string, string>, body: unknown) =>
  app.request("/api/v1/market/listings", { method: "POST", headers: h, body: JSON.stringify(body) }, env);
const getListing = (env: object, h: Record<string, string>, id: string) =>
  app.request(`/api/v1/market/listings/${id}`, { headers: h }, env);
const patchPrefs = (env: object, h: Record<string, string>, body: unknown) =>
  app.request("/api/v1/me/preferences", { method: "PATCH", headers: h, body: JSON.stringify(body) }, env);

const JP_DESC = "この個体は美しい斑紋を持つ。翻訳せず原文のまま保存されること。";

describe("I18-06 UGC 原文保存 + 言語タグ刻印", () => {
  it("locale 未設定なら lang=ja が刻印され description は原文のまま", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const h = await authOf("alice");
    const id = ulid();
    expect((await postListing(env, h, { listing_id: id, title: "出品", description: JP_DESC })).status).toBe(201);

    const j = (await (await getListing(env, h, id)).json()) as {
      listing: { description: string; lang: string };
    };
    expect(j.listing.description).toBe(JP_DESC); // サーバ翻訳せず原文一致
    expect(j.listing.lang).toBe("ja");
  });

  it("actor の locale を設定すると lang にその locale が刻印される", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const h = await authOf("bob");
    await patchPrefs(env, h, { locale: "en" });
    const id = ulid();
    await postListing(env, h, { listing_id: id, title: "listing", description: "a beautiful morph" });

    const j = (await (await getListing(env, h, id)).json()) as { listing: { lang: string; description: string } };
    expect(j.listing.lang).toBe("en");
    expect(j.listing.description).toBe("a beautiful morph");
  });

  it("lang 刻印後も POST /market/listings は 201(schema lang 追加済・回帰なし)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const r = await postListing(env, await authOf("carol"), { title: "no description listing" });
    expect(r.status).toBe(201);
  });
});

// I18-06 part2: 知の広場投稿 + 二人部屋発言も同じ契約(actor locale から lang 刻印・
// サーバ翻訳せず原文保存)を持つ(market listing と同型・market-routes.ts と同じ pattern)。
describe("I18-06 part2 — plaza posts / dispute messages も原文保存 + lang 刻印", () => {
  it("plaza post: locale 未設定なら lang=ja、原文は変更されない", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const h = await authOf("dan");
    const created = await app.request(
      "/api/v1/plaza/posts",
      { method: "POST", headers: h, body: JSON.stringify({ channel: "knowledge-board", topic: "t", board_kind: "guide", body: JP_DESC }) },
      env,
    );
    expect(created.status).toBe(201);
    const { post_id } = (await created.json()) as { post_id: string };
    const detail = (await (await app.request(`/api/v1/plaza/posts/${post_id}`, { headers: h }, env)).json()) as {
      post: { body: string; lang: string };
    };
    expect(detail.post.body).toBe(JP_DESC);
    expect(detail.post.lang).toBe("ja");
  });

  it("plaza post: actor の locale=en を設定すると lang=en が刻印される", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const h = await authOf("erin");
    await patchPrefs(env, h, { locale: "en" });
    const created = await app.request(
      "/api/v1/plaza/posts",
      { method: "POST", headers: h, body: JSON.stringify({ channel: "knowledge-board", topic: "t", board_kind: "guide", body: "english post" }) },
      env,
    );
    const { post_id } = (await created.json()) as { post_id: string };
    const detail = (await (await app.request(`/api/v1/plaza/posts/${post_id}`, { headers: h }, env)).json()) as {
      post: { lang: string };
    };
    expect(detail.post.lang).toBe("en");
  });

  it("dispute message: actor の locale から lang が発言に刻印される", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const h = await authOf("frank");
    await patchPrefs(env, h, { locale: "en" });
    const opened = (await (
      await app.request("/api/v1/gov/disputes", { method: "POST", headers: h, body: JSON.stringify({ category: "board", respondent_id: "bob" }) }, env)
    ).json()) as { dispute_id: string };
    await app.request(
      `/api/v1/gov/disputes/${opened.dispute_id}/messages`,
      { method: "POST", headers: h, body: JSON.stringify({ body: "let's settle" }) },
      env,
    );
    const view = (await (await app.request(`/api/v1/gov/disputes/${opened.dispute_id}`, { headers: h }, env)).json()) as {
      messages: { lang: string; body: string }[];
    };
    expect(view.messages[0].lang).toBe("en");
    expect(view.messages[0].body).toBe("let's settle");
  });
});
