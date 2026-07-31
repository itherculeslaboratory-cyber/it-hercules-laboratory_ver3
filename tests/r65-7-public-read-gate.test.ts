// R65-7/R65-9/R65-10: 認証ミドルウェアを PUBLIC_ROUTES(URL完全一致)から
// PUBLIC_READ_ROUTES(matchedRoutes方式・optional auth)へ切り替えたことの回帰網。
// 設計正本 = kits\lane-think\R0731-9c2323-DESIGN-2026-07-31-g65-authmw.md §7(検証項目
// ①〜⑪のうち、①⑥は既存テストファイル(cl-04-route-matrix.test.ts / observation-ext.test.ts)
// が担う。本ファイルは②③④⑤⑦⑪と R65-10(匿名レート制限フォールバック)を担う。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, ulid } from "@ihl/truth";
import { issueSessionToken } from "../apps/api/src/session";
import { revokeActor } from "../apps/api/src/denylist";
import { memoryKV } from "../apps/api/src/kv";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

const CAPTURE_TYPE = "ihl.obs.capture.v1";

async function putCapture(bucket: FakeR2Bucket, captureId: string, actorId: string, visibility?: string) {
  await new TruthStore(bucket).putEvent({
    specversion: "1.0",
    id: captureId, // putEvent keys by envelope.id: truth/<type>/<id>.json — must equal capture_id
    source: "apps/api",
    type: CAPTURE_TYPE,
    time: "2026-07-31T00:00:00Z",
    dataschema: "schemas/events/obs-capture.schema.json",
    provenance: { generator_kind: "human", actor_id: actorId },
    data: {
      capture_id: captureId,
      actor_id: actorId,
      domain: "biology",
      ...(visibility ? { visibility } : {}),
    },
  });
}

describe("R65-7 ② 静的兄弟の巻き込みなし — export は未ログインで401のまま", () => {
  it("GET /api/v1/observation/export -> 401 AUTH_REQUIRED", async () => {
    const res = await app.request("/api/v1/observation/export", {}, makeEnv());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "AUTH_REQUIRED" });
  });
});

describe("R65-7 ③ 他の静的兄弟(activity-log/datasources)も401のまま", () => {
  it("GET /api/v1/observation/activity-log -> 401", async () => {
    const res = await app.request("/api/v1/observation/activity-log", {}, makeEnv());
    expect(res.status).toBe(401);
  });
  it("GET /api/v1/observation/datasources -> 401", async () => {
    const res = await app.request("/api/v1/observation/datasources", {}, makeEnv());
    expect(res.status).toBe(401);
  });
});

describe("R65-7 ④ メソッド分離 — GET /observation/templates は公開だが POST は保護のまま", () => {
  it("POST /api/v1/observation/templates -> 401(未ログイン)", async () => {
    const res = await app.request(
      "/api/v1/observation/templates",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      makeEnv(),
    );
    expect(res.status).toBe(401);
  });
  it("GET /api/v1/observation/templates -> 401ではない(公開)", async () => {
    const res = await app.request("/api/v1/observation/templates", {}, makeEnv());
    expect(res.status).not.toBe(401);
  });
});

describe("R65-7 ⑤ 未知パスは protected が既定(404ではなく401)", () => {
  it("GET /api/v1/observation/x/存在しないパス -> 401", async () => {
    const res = await app.request(
      encodeURI("/api/v1/observation/x/存在しないパス"),
      {},
      makeEnv(),
    );
    expect(res.status).toBe(401);
  });
});

describe("R65-7 ⑦ 「routeがpublic」≠「データがpublic」 — 非公開captureは未ログインで404", () => {
  it("visibility: private な capture は未ログインで404", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const captureId = ulid();
    await putCapture(bucket, captureId, "owner-a", "private");
    const res = await app.request(`/api/v1/observation/${captureId}`, {}, env);
    expect(res.status).toBe(404);
  });

  it("visibility: uid_linked は未ログインで404・ログイン済みなら200(actorIdが公開routeでも立つ証明)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const captureId = ulid();
    await putCapture(bucket, captureId, "owner-a", "uid_linked");

    const anon = await app.request(`/api/v1/observation/${captureId}`, {}, env);
    expect(anon.status).toBe(404);

    const tok = await issueSessionToken("someone-else", SESSION_SECRET);
    const loggedIn = await app.request(
      `/api/v1/observation/${captureId}`,
      { headers: { Cookie: `ihl_session=${tok}` } },
      env,
    );
    expect(loggedIn.status).toBe(200);
  });
});

describe("R65-7 ⑪ 不変条件II — 公開READに失効/BANトークンを付けても401/403にせず匿名で通す", () => {
  it("失効済みCookieで /health(既存8本)は従来通り200(巻き込まれていない)", async () => {
    const env = makeEnv();
    const actorId = "revoked-health-1";
    const session = await issueSessionToken(actorId, SESSION_SECRET);
    await revokeActor(env.AUTH_DENYLIST, actorId);

    const res = await app.request("/health", { headers: { Cookie: `ihl_session=${session}` } }, env);
    expect(res.status).toBe(200);
  });

  it("失効済みCookieで公開READ(GET /observation/{capture_id})は401/403ではなく200(閲覧面fail-open)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const captureId = ulid();
    await putCapture(bucket, captureId, "owner-a"); // visibility省略=public

    const actorId = "revoked-reader-1";
    const session = await issueSessionToken(actorId, SESSION_SECRET);
    await revokeActor(env.AUTH_DENYLIST, actorId);

    const res = await app.request(
      `/api/v1/observation/${captureId}`,
      { headers: { Cookie: `ihl_session=${session}` } },
      env,
    );
    expect(res.status).toBe(200);
  });

  it("失効済みCookieで protected route(/api/v1/me/ledger)は従来通り401 SESSION_REVOKED(不変条件Iの再確認)", async () => {
    const env = makeEnv();
    const actorId = "revoked-protected-1";
    const session = await issueSessionToken(actorId, SESSION_SECRET);
    await revokeActor(env.AUTH_DENYLIST, actorId);

    const res = await app.request(
      "/api/v1/me/ledger",
      { headers: { Cookie: `ihl_session=${session}` } },
      env,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "SESSION_REVOKED" });
  });
});

describe("R65-10 匿名レート制限フォールバック — 公開POSTを匿名で叩いてもキーがIP単位で効く", () => {
  it("RATE_LIMIT を1回分の上限で埋めると、匿名POST /observation/search が429で止まる", async () => {
    const env = { ...makeEnv(), RATE_LIMIT: memoryKV() };
    const searchBody = { headers: { "content-type": "application/json" }, method: "POST", body: "{}" };

    // 1回目は通る(personalize等のバリデーションで4xxでも429ではないことだけ見る)。
    const first = await app.request("/api/v1/observation/search", searchBody, env);
    expect(first.status).not.toBe(429);

    // 上限(WRITE_RATE_LIMIT_PER_MINUTE=60)まで同じ匿名IPキーを埋める。
    for (let i = 0; i < 60; i++) {
      await app.request("/api/v1/observation/search", searchBody, env);
    }
    const limited = await app.request("/api/v1/observation/search", searchBody, env);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: "RATE_LIMITED" });
  });

  it("フォールバックを外す(actorId固定のまま)とこのテストが赤くなることの確認 — 別IPは別バケットに乗る(取り違えていないこと)", async () => {
    const env = { ...makeEnv(), RATE_LIMIT: memoryKV() };
    const bodyFor = (ip: string) => ({
      headers: { "content-type": "application/json", "CF-Connecting-IP": ip },
      method: "POST" as const,
      body: "{}",
    });
    for (let i = 0; i < 60; i++) {
      await app.request("/api/v1/observation/search", bodyFor("203.0.113.1"), env);
    }
    const limited = await app.request("/api/v1/observation/search", bodyFor("203.0.113.1"), env);
    expect(limited.status).toBe(429);

    // 別IPはまだバケットが空 — 429にならない。
    const otherIp = await app.request("/api/v1/observation/search", bodyFor("203.0.113.2"), env);
    expect(otherIp.status).not.toBe(429);
  });
});
