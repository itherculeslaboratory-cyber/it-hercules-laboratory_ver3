// V3-AUT-46 数字コード verify TC(round-16 OQ-ONB-03「別端末/webviewの普遍の逃げ道」)。
// magic-link 発行時に同一 OTP(iat 由来)を6桁コードとしても返し、POST /api/v1/auth/
// verify-code(email+code→session)で検証する。ワンタイム性・試行回数制限・期限は
// magic-link と同一(MAGIC_TTL 窓)。BAN ゲートも /verify と同契約。
import { describe, expect, it, vi } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore, deriveActorId } from "@ihl/truth";
import { grantKarmaCountIncrease } from "../apps/api/src/ledger-routes";
import { issueNumericCode } from "../apps/api/src/session";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

// ponytail: known flake under parallel test-runner load (many suites' real
// Web Crypto HMAC/hash calls contend for CPU) — vitest's 5s default timeout
// occasionally trips here. Raise per-file, not globally; upgrade to a shared
// slow-crypto-suite config if more files start flaking the same way.
vi.setConfig({ testTimeout: 15000 });

const JSON_HEADERS = { "content-type": "application/json" };

async function sendMagicLink(email: string, env: ReturnType<typeof makeEnv>) {
  return app.request(
    "/api/v1/auth/magic-link",
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email }) },
    { ...env, IHL_DEV_EXPOSE_MAGIC_TOKEN: "1" },
  );
}

function verifyCode(email: string, code: string, env: ReturnType<typeof makeEnv>) {
  return app.request(
    "/api/v1/auth/verify-code",
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email, code }) },
    env,
  );
}

describe("V3-AUT-46 数字コード verify — 正常系", () => {
  it("magic-link は dev_numeric_code(6桁)も返す(フラグ ON 時のみ)", async () => {
    const env = makeEnv();
    const off = await app.request(
      "/api/v1/auth/magic-link",
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email: "a@b.com" }) },
      env,
    );
    expect((await off.json() as { dev_numeric_code?: string }).dev_numeric_code).toBeUndefined();

    const on = await sendMagicLink("a@b.com", env);
    const body = (await on.json()) as { dev_numeric_code?: string };
    expect(body.dev_numeric_code).toMatch(/^\d{6}$/);
  });

  it("email+code で session cookie が発行され、保護 write を認証できる", async () => {
    const env = makeEnv();
    const ml = await sendMagicLink("coder@example.com", env);
    const { dev_numeric_code } = (await ml.json()) as { dev_numeric_code: string };

    const res = await verifyCode("coder@example.com", dev_numeric_code, env);
    expect(res.status).toBe(200);
    const { actor_id } = (await res.json()) as { actor_id: string };
    expect(actor_id).toBe(await deriveActorId("coder@example.com"));
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("ihl_session=");
    expect(setCookie).toContain("HttpOnly");

    const cookie = setCookie.split(";")[0];
    const write = await app.request(
      "/api/v1/auth/session",
      { headers: { Cookie: cookie } },
      env,
    );
    expect(await write.json()).toEqual({ authenticated: true, actor_id });
  });

  it("email 大文字小文字/空白ゆらぎは同一 actor(第6回裁定③と同じ正規化)", async () => {
    const env = makeEnv();
    const ml = await sendMagicLink("  User@Example.COM  ", env);
    const { dev_numeric_code } = (await ml.json()) as { dev_numeric_code: string };
    const res = await verifyCode("user@example.com", dev_numeric_code, env);
    expect(res.status).toBe(200);
  });
});

describe("V3-AUT-46 数字コード verify — 否定系(コード誤り/期限切れ/試行超過)", () => {
  it("コード誤り → 401 INVALID_CODE", async () => {
    const env = makeEnv();
    await sendMagicLink("wrong@example.com", env);
    const res = await verifyCode("wrong@example.com", "000000", env);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "INVALID_CODE" });
  });

  it("コードが6桁数字でない → 400 INVALID_CODE", async () => {
    const env = makeEnv();
    const res = await verifyCode("x@y.z", "abc123", env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_CODE" });
  });

  it("email 不正 → 400 INVALID_EMAIL", async () => {
    const env = makeEnv();
    const res = await verifyCode("not-an-email", "123456", env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_EMAIL" });
  });

  it("期限切れ(MAGIC_TTL 窓外の iat 由来コード)→ 401 INVALID_CODE", async () => {
    const env = makeEnv();
    const email = "expired@example.com";
    const staleIat = Math.floor(Date.now() / 1000) - 20 * 60; // 20分前(MAGIC_TTL=15分を超過)
    const staleCode = await issueNumericCode(email, staleIat, SESSION_SECRET);
    const res = await verifyCode(email, staleCode, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "INVALID_CODE" });
  });

  it("ワンタイム性: 同じコードは1回しか使えない(2回目は401)", async () => {
    const env = makeEnv();
    const ml = await sendMagicLink("once@example.com", env);
    const { dev_numeric_code } = (await ml.json()) as { dev_numeric_code: string };

    const first = await verifyCode("once@example.com", dev_numeric_code, env);
    expect(first.status).toBe(200);

    const second = await verifyCode("once@example.com", dev_numeric_code, env);
    expect(second.status).toBe(401);
    expect(await second.json()).toEqual({ error: "INVALID_CODE" });
  });

  it("試行回数制限: CODE_MAX_ATTEMPTS(5) を超えると429 TOO_MANY_ATTEMPTS", async () => {
    const env = makeEnv();
    const email = "bruteforce@example.com";
    await sendMagicLink(email, env);
    for (let i = 0; i < 5; i++) {
      const res = await verifyCode(email, "000000", env);
      expect(res.status).toBe(401);
    }
    const sixth = await verifyCode(email, "000000", env);
    expect(sixth.status).toBe(429);
    expect(await sixth.json()).toEqual({ error: "TOO_MANY_ATTEMPTS" });
  });

  it("正解コードでも試行上限に達していれば429(直前に誤り5回)", async () => {
    const env = makeEnv();
    const email = "locked@example.com";
    const ml = await sendMagicLink(email, env);
    const { dev_numeric_code } = (await ml.json()) as { dev_numeric_code: string };
    for (let i = 0; i < 5; i++) await verifyCode(email, "999999", env);
    const res = await verifyCode(email, dev_numeric_code, env);
    expect(res.status).toBe(429);
  });

  it("BAN ユーザーは正しいコードでも 403 BANNED(/verify と同契約)", async () => {
    const bucket = new FakeR2Bucket();
    const email = "banned-code@example.com";
    const actorId = await deriveActorId(email);
    await grantKarmaCountIncrease(new TruthStore(bucket), actorId, 10); // → BAN
    const env = makeEnv(bucket);
    const ml = await sendMagicLink(email, env);
    const { dev_numeric_code } = (await ml.json()) as { dev_numeric_code: string };
    const res = await verifyCode(email, dev_numeric_code, env);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "BANNED" });
  });
});
