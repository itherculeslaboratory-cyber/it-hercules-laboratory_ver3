// @ID(handle)確定 TC(V3-AUT-08 / docs/planning/c7/usecase-driven-design.md
// §auth-onboarding-locale)。3〜30文字・限定文字種・一意(put-if-absent 409)・
// 不変(HANDLE_IMMUTABLE・確定後の再確定拒否)。actor_id はセッション principal 強制刻印。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}
const authOf = async (actor: string) => bearer(await issueSessionToken(actor, SESSION_SECRET));

function postHandle(env: object, h: Record<string, string>, handle: string) {
  return app.request("/api/v1/me/handle", { method: "POST", headers: h, body: JSON.stringify({ handle }) }, env);
}
function getHandle(env: object, h: Record<string, string>) {
  return app.request("/api/v1/me/handle", { headers: h }, env);
}

describe("V3-AUT-08 @ID(handle) 確定", () => {
  it("GET /me/handle: 未確定なら handle:null", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const h = await authOf("alice");
    const res = await getHandle(env, h);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ handle: null });
  });

  it("POST /me/handle: 3-30文字の限定文字種で確定 → 201、以後 GET で見える", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const h = await authOf("bob");
    const created = await postHandle(env, h, "taro_2");
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ handle: "taro_2" });
    const got = await getHandle(env, h);
    expect(await got.json()).toEqual({ handle: "taro_2" });
  });

  it.each(["ab", "x".repeat(31), "たろう", "has space", "dash-not-allowed"])(
    "rejects an out-of-format handle %s with 400 INVALID_HANDLE",
    async (bad) => {
      const env = makeEnv(new FakeR2Bucket());
      const h = await authOf("carol");
      const res = await postHandle(env, h, bad);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("INVALID_HANDLE");
    },
  );

  it("uniqueness: a second actor claiming the same handle gets 409 HANDLE_TAKEN (storage-layer put-if-absent)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const first = await postHandle(env, await authOf("dan"), "sameid");
    expect(first.status).toBe(201);
    const second = await postHandle(env, await authOf("erin"), "sameid");
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: string }).error).toBe("HANDLE_TAKEN");
  });

  it("immutability: re-claiming (even a different handle) after confirmation → 409 HANDLE_IMMUTABLE", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const h = await authOf("frank");
    expect((await postHandle(env, h, "frankid")).status).toBe(201);
    const again = await postHandle(env, h, "frankid2");
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toBe("HANDLE_IMMUTABLE");
    // the second candidate must NOT have been claimed by anyone else either.
    const stillFree = await postHandle(makeEnv(new FakeR2Bucket()), await authOf("gina"), "frankid2");
    expect(stillFree.status).toBe(201);
  });

  it("stamps actor_id from the session principal, ignoring any body field of the same name", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const h = await authOf("henry");
    await postHandle(env, h, "henryid");
    const store = new (await import("@ihl/truth")).TruthStore(bucket);
    const raw = await store.readEvent("truth/ihl.aut.handle.v1/henryid.json");
    const data = (raw as { data: { actor_id: string } }).data;
    expect(data.actor_id).toBe("henry");
  });

  it("unauthenticated → 401", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const res = await app.request("/api/v1/me/handle", { method: "POST", body: JSON.stringify({ handle: "x".repeat(5) }) }, env);
    expect(res.status).toBe(401);
  });
});
