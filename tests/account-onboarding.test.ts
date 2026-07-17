// V3-AUT-09(オープン登録アカウント行)+ V3-AUT-10/V3-I18-02(必須2ゲート onboarding)
// TC。独立サインアップ画面は無く、マジックリンク初回検証で account 行を put-if-absent
// (2回目以降はidempotent no-op)。onboardingComplete は handle+locale の両方が
// 明示確定して初めて true(片方だけでは false のまま)。handle ゲートの実体は
// setup-profile.json 画面と同じ PATCH /me/preferences{handle}(pref-set)——
// POST /me/handle は別機能(V3-AUT-08・一意@handleクレーム)で onboarding ゲートには
// 使わない(account.ts projectOnboardingStatus 参照)。
import { describe, expect, it } from "vitest";
import { TruthStore } from "@ihl/truth";
import app from "../apps/api/src/index";
import { FakeR2Bucket, makeEnv } from "./helpers";

const JSON_HEADERS = { "content-type": "application/json" };

async function login(bucket: FakeR2Bucket, email: string) {
  const env = { ...makeEnv(bucket), IHL_DEV_EXPOSE_MAGIC_TOKEN: "1" };
  const ml = await app.request(
    "/api/v1/auth/magic-link",
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email }) },
    env,
  );
  const { dev_magic_token } = (await ml.json()) as { dev_magic_token: string };
  const vr = await app.request(
    "/api/v1/auth/verify",
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ token: dev_magic_token }) },
    env,
  );
  const setCookie = vr.headers.get("set-cookie") ?? "";
  const { actor_id } = (await vr.json()) as { actor_id: string };
  return { actorId: actor_id, cookie: setCookie.split(";")[0], verifyStatus: vr.status };
}

describe("V3-AUT-09 open registration — account row created on first verify", () => {
  it("first verify put-if-absents truth/ihl.aut.account.v1/<actor_id>.json", async () => {
    const bucket = new FakeR2Bucket();
    const { actorId, verifyStatus } = await login(bucket, "newuser@example.com");
    expect(verifyStatus).toBe(200);
    const store = new TruthStore(bucket);
    const row = await store.readEvent(`truth/ihl.aut.account.v1/${actorId}.json`);
    expect(row).not.toBeNull();
    expect((row as { data: { actor_id: string } }).data.actor_id).toBe(actorId);
  });

  it("a second verify for the same email is idempotent (still 200, single account row)", async () => {
    const bucket = new FakeR2Bucket();
    await login(bucket, "repeat@example.com");
    const second = await login(bucket, "repeat@example.com");
    expect(second.verifyStatus).toBe(200);
    const store = new TruthStore(bucket);
    const rows = await store.listEvents(`truth/ihl.aut.account.v1/`);
    expect(rows).toHaveLength(1);
  });
});

describe("V3-AUT-10/V3-I18-02 onboardingComplete — required 2 gates (handle + locale)", () => {
  it("GET /session + GET /me/onboarding report false until BOTH handle and locale are set", async () => {
    const bucket = new FakeR2Bucket();
    const { cookie } = await login(bucket, "onboard@example.com");
    const h = { Cookie: cookie, ...JSON_HEADERS };
    const env = makeEnv(bucket);

    const before = (await (await app.request("/api/v1/auth/session", { headers: h }, env)).json()) as {
      onboarding_complete: boolean;
    };
    expect(before.onboarding_complete).toBe(false);
    const onboardingBefore = (await (
      await app.request("/api/v1/me/onboarding", { headers: h }, env)
    ).json()) as { onboarding_complete: boolean; handle: string | null; locale_set: boolean };
    expect(onboardingBefore).toEqual({ onboarding_complete: false, handle: null, locale_set: false });

    // handle only -> still false (locale gate missing)
    await app.request("/api/v1/me/preferences", { method: "PATCH", headers: h, body: JSON.stringify({ handle: "onboarduser" }) }, env);
    const handleOnly = (await (await app.request("/api/v1/me/onboarding", { headers: h }, env)).json()) as {
      onboarding_complete: boolean;
    };
    expect(handleOnly.onboarding_complete).toBe(false);

    // + locale -> now true (both gates satisfied)
    await app.request("/api/v1/me/preferences", { method: "PATCH", headers: h, body: JSON.stringify({ locale: "ja" }) }, env);
    const after = (await (await app.request("/api/v1/me/onboarding", { headers: h }, env)).json()) as {
      onboarding_complete: boolean;
      handle: string | null;
      locale_set: boolean;
    };
    expect(after).toEqual({ onboarding_complete: true, handle: "onboarduser", locale_set: true });

    const sessionAfter = (await (await app.request("/api/v1/auth/session", { headers: h }, env)).json()) as {
      onboarding_complete: boolean;
    };
    expect(sessionAfter.onboarding_complete).toBe(true);
  });

  it("locale alone (no handle) is not enough", async () => {
    const bucket = new FakeR2Bucket();
    const { cookie } = await login(bucket, "localeonly@example.com");
    const h = { Cookie: cookie, ...JSON_HEADERS };
    const env = makeEnv(bucket);
    await app.request("/api/v1/me/preferences", { method: "PATCH", headers: h, body: JSON.stringify({ locale: "en" }) }, env);
    const status = (await (await app.request("/api/v1/me/onboarding", { headers: h }, env)).json()) as {
      onboarding_complete: boolean;
    };
    expect(status.onboarding_complete).toBe(false);
  });
});
