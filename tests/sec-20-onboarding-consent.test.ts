// V3-SEC-20(仕上げ): オンボーディング MUST_AGREE_TO_TERMS ゲート + CL-05 consent-record
// append-only 永続化。既存で満たされている部分(未認証 /onboarding/terms 閲覧・login.json の
// 必須チェックボックスによる送信disable)はコード変更なし=本ファイルの対象外(consent-routes.ts
// 冒頭コメント参照)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { AUTH_HEADERS, makeEnv } from "./helpers";

describe("V3-SEC-20 POST /api/v1/onboarding/agree", () => {
  it("missing agreedPrivacy -> 400 MUST_AGREE_TO_TERMS", async () => {
    const res = await app.request(
      "/api/v1/onboarding/agree",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ agreedTerms: true }) },
      makeEnv(),
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "MUST_AGREE_TO_TERMS" });
  });

  it("both false -> 400 MUST_AGREE_TO_TERMS", async () => {
    const res = await app.request(
      "/api/v1/onboarding/agree",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ agreedTerms: false, agreedPrivacy: false }) },
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("both true -> 201, persists both, GET /me/consent reflects it", async () => {
    const env = makeEnv();
    const res = await app.request(
      "/api/v1/onboarding/agree",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ agreedTerms: true, agreedPrivacy: true }) },
      env,
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ agreedTerms: true, agreedPrivacy: true });

    const check = await app.request("/api/v1/me/consent", { headers: AUTH_HEADERS }, env);
    expect(await check.json()).toEqual({ agreedTerms: true, agreedPrivacy: true });
  });

  it("unauthenticated -> 401 (deny-by-default)", async () => {
    const res = await app.request(
      "/api/v1/onboarding/agree",
      { method: "POST", body: JSON.stringify({ agreedTerms: true, agreedPrivacy: true }) },
      makeEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("GET /me/consent before agreeing reports both false", async () => {
    const res = await app.request("/api/v1/me/consent", { headers: AUTH_HEADERS }, makeEnv());
    expect(await res.json()).toEqual({ agreedTerms: false, agreedPrivacy: false });
  });

  it("appends TWO append-only consent-record events (terms + privacy), never overwrites", async () => {
    const env = makeEnv();
    await app.request(
      "/api/v1/onboarding/agree",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ agreedTerms: true, agreedPrivacy: true }) },
      env,
    );
    // a second onboarding call appends TWO MORE records (append-only; no conflict, no overwrite).
    const second = await app.request(
      "/api/v1/onboarding/agree",
      { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ agreedTerms: true, agreedPrivacy: true }) },
      env,
    );
    expect(second.status).toBe(201);
  });
});
