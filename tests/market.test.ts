// C4 マーケット骨格 TC (design-c4 §3 / V3-MKT-01 — 出品/閲覧まで).
// 出品→一覧→詳細の一致・未認証 401・不正 payload(title 欠落)400・冪等 409。
// data.actor_id はセッション principal 強制刻印(V3-AUT-17)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { deriveActorId, ulid } from "@ihl/truth";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

const DEV_ACTOR = await deriveActorId("dev@ihl.local");

function post(env: ReturnType<typeof makeEnv>, body: unknown) {
  return app.request(
    "/api/v1/market/listings",
    { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(body) },
    env,
  );
}

describe("POST /api/v1/market/listings(出品)", () => {
  it("出品→一覧→詳細が一致(title/actor_id)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const created = await post(env, { title: "青いカブトムシ", description: "F1 個体", price: 3000 });
    expect(created.status).toBe(201);
    const { listing_id } = (await created.json()) as { listing_id: string };
    expect(listing_id).toBeTruthy();

    const list = await app.request("/api/v1/market/listings", { headers: AUTH_HEADERS }, env);
    expect(list.status).toBe(200);
    const { listings } = (await list.json()) as { listings: Record<string, unknown>[] };
    const inList = listings.find((l) => l.listing_id === listing_id);
    expect(inList).toMatchObject({ listing_id, title: "青いカブトムシ", actor_id: DEV_ACTOR, price: 3000 });

    const detail = await app.request(`/api/v1/market/listings/${listing_id}`, { headers: AUTH_HEADERS }, env);
    expect(detail.status).toBe(200);
    const { listing } = (await detail.json()) as { listing: Record<string, unknown> };
    expect(listing).toEqual(inList); // 一覧と詳細が一致
  });

  it("actor_id は body 詐称を無視しセッション principal を刻印(V3-AUT-17)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const created = await post(env, { title: "x", actor_id: "attacker" });
    const { listing_id } = (await created.json()) as { listing_id: string };
    const detail = await app.request(`/api/v1/market/listings/${listing_id}`, { headers: AUTH_HEADERS }, env);
    const { listing } = (await detail.json()) as { listing: Record<string, unknown> };
    expect(listing.actor_id).toBe(DEV_ACTOR);
  });

  it("不正 payload(title 欠落)→ 400", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const res = await post(env, { description: "no title" });
    expect(res.status).toBe(400);
  });

  it("同一 listing_id の二重出品 → 409(append-only 冪等)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const id = ulid();
    const first = await post(env, { listing_id: id, title: "a" });
    expect(first.status).toBe(201);
    const dup = await post(env, { listing_id: id, title: "b" });
    expect(dup.status).toBe(409);
  });
});

describe("マーケット route は全て保護(未認証 401)", () => {
  it("POST/GET 一覧/GET 詳細 いずれも認証なしは 401", async () => {
    const env = makeEnv();
    for (const req of [
      app.request("/api/v1/market/listings", { method: "POST", body: "{}" }, env),
      app.request("/api/v1/market/listings", {}, env),
      app.request("/api/v1/market/listings/x", {}, env),
    ]) {
      expect((await req).status).toBe(401);
    }
  });
});

describe("GET /api/v1/market/listings/{id}", () => {
  it("存在しない listing_id → 404", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const res = await app.request("/api/v1/market/listings/nope", { headers: AUTH_HEADERS }, env);
    expect(res.status).toBe(404);
  });
});
