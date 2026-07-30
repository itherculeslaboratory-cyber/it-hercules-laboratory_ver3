// V3-AUT-03 失効 denylist TC(round-16 Q-REQ-03「KVデニーリスト・MVP必須格上げ」)。
// BAN(V3-KRM-04・karma_value 閾値越え)・行政命令フラグ(V3-GOV-09)から denylist
// (userId→失効時刻)へ配線し、requireAuth ミドルウェアが毎リクエスト照会する
// (iat < 失効時刻 → 401)。既発行セッション(iat が失効前)の即時失効を検証する —
// これが無いと BAN 後も exp(30日)まで既存セッションが生き続けてしまう。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, deriveActorId } from "@ihl/truth";
import { issueSessionToken } from "../apps/api/src/session";
import { revokeActor, isDenylisted, revocationOf } from "../apps/api/src/denylist";
import { appendKarma, grantKarmaCountIncrease, isBanned, projectLedger } from "../apps/api/src/ledger-routes";
import { GOV_FLAG_COUNT_STEPS } from "../apps/api/src/plaza-constants";
import { memoryKV } from "../apps/api/src/kv";
import { AUTH_HEADERS, FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}

async function operatorHeaders() {
  const tok = await issueSessionToken("operator-9", SESSION_SECRET, ["operator"]);
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}

describe("V3-AUT-03 denylist(単体) — isDenylisted/revokeActor", () => {
  it("未登録は false", async () => {
    const kv = memoryKV();
    expect(await isDenylisted(kv, "someone", 0)).toBe(false);
  });

  it("revoke 後、失効時刻より前の iat は denylist 命中", async () => {
    const kv = memoryKV();
    const now = Math.floor(Date.now() / 1000);
    await revokeActor(kv, "actor-1", now);
    expect(await isDenylisted(kv, "actor-1", now - 10)).toBe(true);
  });

  it("失効時刻以降に issue された iat は通過(可逆 — KRM-04 の可逆性と整合)", async () => {
    const kv = memoryKV();
    const now = Math.floor(Date.now() / 1000);
    await revokeActor(kv, "actor-1", now);
    expect(await isDenylisted(kv, "actor-1", now + 10)).toBe(false);
  });

  it("kv 未バインド(undefined)は no-op で false — 機能全体を落とさない", async () => {
    await expect(revokeActor(undefined, "actor-1")).resolves.toBeUndefined();
    expect(await isDenylisted(undefined, "actor-1", 0)).toBe(false);
  });
});

describe("V3-AUT-03 requireAuth ミドルウェア照会 — 既発行セッションの即時失効", () => {
  it("cookie セッション: revoke 後は 401 SESSION_REVOKED", async () => {
    const env = makeEnv();
    const actorId = await deriveActorId("revoked-cookie@example.com");
    const session = await issueSessionToken(actorId, SESSION_SECRET);
    const cookieHeader = { Cookie: `ihl_session=${session}` };

    // revoke 前は通る。
    const before = await app.request("/api/v1/me/ledger", { headers: cookieHeader }, env);
    expect(before.status).toBe(200);

    await revokeActor(env.AUTH_DENYLIST, actorId);

    const after = await app.request("/api/v1/me/ledger", { headers: cookieHeader }, env);
    expect(after.status).toBe(401);
    expect(await after.json()).toEqual({ error: "SESSION_REVOKED" });
  });

  it("bearer セッション: revoke 後は 401 SESSION_REVOKED", async () => {
    const env = makeEnv();
    const actorId = await deriveActorId("revoked-bearer@example.com");
    const session = await issueSessionToken(actorId, SESSION_SECRET);
    await revokeActor(env.AUTH_DENYLIST, actorId);

    const res = await app.request("/api/v1/me/ledger", { headers: bearer(session) }, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "SESSION_REVOKED" });
  });

  it("revoke 後に issue された新セッションは通る(可逆)", async () => {
    const env = makeEnv();
    const actorId = await deriveActorId("re-issued@example.com");
    const past = Math.floor(Date.now() / 1000) - 60; // 失効を明確に過去時刻にする(同一秒の曖昧さ回避)
    await revokeActor(env.AUTH_DENYLIST, actorId, past);
    // 失効時刻より後に新セッションを issue(現実には再ログイン相当)。
    const fresh = await issueSessionToken(actorId, SESSION_SECRET);
    const res = await app.request("/api/v1/me/ledger", { headers: bearer(fresh) }, env);
    expect(res.status).toBe(200);
  });

  it("DEV_TOKEN 経路は denylist の対象外(既存契約通り)", async () => {
    const env = makeEnv();
    const devActor = await deriveActorId("dev@ihl.local");
    await revokeActor(env.AUTH_DENYLIST, devActor);
    const res = await app.request("/api/v1/me/ledger", { headers: AUTH_HEADERS }, env);
    expect(res.status).toBe(200);
  });
});

describe("V3-AUT-03 BAN(V3-KRM-04)から denylist への配線", () => {
  it("grantKarmaCountIncrease が BAN 閾値を跨ぐと、既発行セッションが即時失効する", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const actorId = await deriveActorId("cross-ban@example.com");
    const session = await issueSessionToken(actorId, SESSION_SECRET);

    // BAN 前は通る。
    const before = await app.request("/api/v1/me/ledger", { headers: bearer(session) }, env);
    expect(before.status).toBe(200);

    const s = new TruthStore(bucket);
    await grantKarmaCountIncrease(s, actorId, 10, "dispute", env.AUTH_DENYLIST); // fibPenalty(0,10)=143 → BAN

    const after = await app.request("/api/v1/me/ledger", { headers: bearer(session) }, env);
    expect(after.status).toBe(403);
    expect(await after.json()).toEqual({ error: "KARMA_SUSPENDED" });
  });

  it("BAN 閾値を跨がない小さいペナルティは denylist に触れない(既存セッションは生存)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const actorId = await deriveActorId("small-penalty@example.com");
    const session = await issueSessionToken(actorId, SESSION_SECRET);

    const s = new TruthStore(bucket);
    await grantKarmaCountIncrease(s, actorId, 1, "other", env.AUTH_DENYLIST); // value -1、閾値未到達

    const res = await app.request("/api/v1/me/ledger", { headers: bearer(session) }, env);
    expect(res.status).toBe(200);
  });

  it("kv 未指定(既存の直接呼び出し・cron 等)は従来どおり denylist に触れない", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const actorId = await deriveActorId("no-kv@example.com");
    const session = await issueSessionToken(actorId, SESSION_SECRET);

    const s = new TruthStore(bucket);
    await grantKarmaCountIncrease(s, actorId, 10); // kv 省略 → BAN するが denylist は書かれない

    const res = await app.request("/api/v1/me/ledger", { headers: bearer(session) }, env);
    expect(res.status).toBe(200); // denylist 未登録なので通る(署名/期限のみ判定)
  });
});

describe("V3-AUT-03 行政命令フラグ(V3-GOV-09)から denylist への配線", () => {
  it("GOV-09 flag は BAN 閾値を跨がなくても対象 owner を無条件で即時失効する", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const actorId = await deriveActorId("gov-flag-target@example.com");
    const session = await issueSessionToken(actorId, SESSION_SECRET);

    // 事前に月次救済で value を押し上げておく(GOV_FLAG_COUNT_STEPS=10 の Fib 減点
    // fibPenalty(0,10)=143 を相殺しても BAN 閾値(-100)を跨がないようにする検証)。
    const s = new TruthStore(bucket);
    await appendKarma(s, actorId, "value", 90, "monthly_batch");

    const before = await app.request("/api/v1/me/ledger", { headers: bearer(session) }, env);
    expect(before.status).toBe(200);
    const beforeLedger = (await before.json()) as { karma_value: number };
    expect(beforeLedger.karma_value).toBe(90);

    const res = await app.request(
      "/api/v1/gov/flags",
      {
        method: "POST",
        headers: await operatorHeaders(),
        body: JSON.stringify({ target_type: "listing", target_id: "L-99", target_owner: actorId, reason: "test" }),
      },
      env,
    );
    expect(res.status).toBe(201);

    // 前提の裏取り: フラグ後も BAN 閾値(-100)は跨いでいない(90 - fibPenalty(0,10)=143 = -53)。
    const afterFlag = await projectLedger(s, actorId);
    expect(afterFlag.karma_value).toBe(-53);
    expect(await isBanned(s, actorId)).toBe(false);

    // それでも既発行セッションは denylist で即時失効している(無条件配線の主眼)。
    const revoked = await app.request("/api/v1/me/ledger", { headers: bearer(session) }, env);
    expect(revoked.status).toBe(401);
    expect(await revoked.json()).toEqual({ error: "SESSION_REVOKED" });
  });

  it("GOV_FLAG_COUNT_STEPS のペナルティは BAN 閾値を跨がない(検証の前提)", () => {
    // 90 - fibPenalty(0,10) = 90 - 143 = -53 > -100(KARMA_BAN_THRESHOLD)。
    expect(GOV_FLAG_COUNT_STEPS).toBe(10);
  });
});

// V3-AUT-19 差し戻し是正(2026-07-31): denylist の値に失効理由コードを持たせる。
// revocationOf 自体は denylist.ts 単体の契約なので index.ts の変更なしに検証できる。
describe("V3-AUT-19 失効理由コード — revocationOf(denylist.ts単体)", () => {
  it("reason 付き revokeActor は revocationOf で理由を返す", async () => {
    const kv = memoryKV();
    const now = Math.floor(Date.now() / 1000);
    await revokeActor(kv, "actor-ban", now, "karma_ban");
    expect(await revocationOf(kv, "actor-ban", now - 10)).toEqual({ revoked: true, reason: "karma_ban" });
  });

  it("reason 省略の revokeActor(既定=旧形式)は revocationOf で reason=null", async () => {
    const kv = memoryKV();
    const now = Math.floor(Date.now() / 1000);
    await revokeActor(kv, "actor-x", now); // reason 省略 → 後方互換で "<epoch>" のみ書く
    expect(await revocationOf(kv, "actor-x", now - 10)).toEqual({ revoked: true, reason: null });
  });

  it("KV へ直接 put した旧形式値(パイプなし・移行前データ想定)も reason=null で読める", async () => {
    const kv = memoryKV();
    const now = Math.floor(Date.now() / 1000);
    await kv.put("actor-legacy", String(now));
    expect(await revocationOf(kv, "actor-legacy", now - 10)).toEqual({ revoked: true, reason: null });
  });

  it("isDenylisted(既存 boolean 契約)は reason 付きエントリでも壊れない", async () => {
    const kv = memoryKV();
    const now = Math.floor(Date.now() / 1000);
    await revokeActor(kv, "actor-ban2", now, "karma_ban");
    expect(await isDenylisted(kv, "actor-ban2", now - 10)).toBe(true);
    expect(await isDenylisted(kv, "actor-ban2", now + 10)).toBe(false);
  });
});

// KV へ直接 put する旧形式(理由なし)の値が保護 API 経路でも従来どおり SESSION_REVOKED
// になることの回帰テスト。index.ts は isDenylisted(boolean契約)を呼ぶだけなので、
// この経路は本レーンの denylist.ts 変更だけで(index.ts 無改修のまま)通る。
describe("V3-AUT-19 後方互換 — 旧形式KV値は index.ts 無改修のまま SESSION_REVOKED", () => {
  it("KV に直接 put した旧形式値(理由なし)は 401 SESSION_REVOKED のまま", async () => {
    const env = makeEnv();
    const actorId = await deriveActorId("legacy-format@example.com");
    const session = await issueSessionToken(actorId, SESSION_SECRET);
    const now = Math.floor(Date.now() / 1000);
    await env.AUTH_DENYLIST.put(actorId, String(now));
    const res = await app.request("/api/v1/me/ledger", { headers: bearer(session) }, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "SESSION_REVOKED" });
  });
});

// index.ts・ledger-routes.ts への AUT-19 是正diff(n62fix1・2026-07-31 適用済み)により
// it.skip を解除(n62aut03)。
describe("V3-AUT-19 KARMA_SUSPENDED(index.ts+ledger-routes.ts diff適用済み)", () => {
  it("カルマがBAN域まで落ちた既発行セッションは 403 KARMA_SUSPENDED", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const actorId = await deriveActorId("karma-suspended-419@example.com");
    const session = await issueSessionToken(actorId, SESSION_SECRET);
    const s = new TruthStore(bucket);
    await grantKarmaCountIncrease(s, actorId, 10, "dispute", env.AUTH_DENYLIST); // fibPenalty(0,10)=143 → BAN
    const after = await app.request("/api/v1/me/ledger", { headers: bearer(session) }, env);
    expect(after.status).toBe(403);
    expect(await after.json()).toEqual({ error: "KARMA_SUSPENDED" });
  });
});
