// C2 認証 TC (design-c2 §1): 署名付きステートレスセッション + マジックリンク.
// V3-AUT-01/03/05/17・CL-03 email 正規化・第6回裁定③.
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { deriveActorId } from "@ihl/truth";
import { FakeR2Bucket, SESSION_SECRET, makeEnv, makeEnvelope } from "./helpers";
import {
  issueMagicToken,
  issueSessionToken,
  signToken,
  verifySessionToken,
} from "../apps/api/src/session";

const JSON_HEADERS = { "content-type": "application/json" };

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, ...JSON_HEADERS };
}

// magic-link → dev token → verify → session cookie. Returns { actorId, cookie }.
async function login(email: string, env = makeEnv()) {
  const ml = await app.request(
    "/api/v1/auth/magic-link",
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email }) },
    { ...env, IHL_DEV_EXPOSE_MAGIC_TOKEN: "1" },
  );
  const { dev_magic_token } = (await ml.json()) as { dev_magic_token: string };
  const vr = await app.request(
    "/api/v1/auth/verify",
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ token: dev_magic_token }) },
    env,
  );
  const setCookie = vr.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0]; // ihl_session=...
  const { actor_id } = (await vr.json()) as { actor_id: string };
  return { actorId: actor_id, cookie, verifyRes: vr, setCookie };
}

describe("C2 auth — magic-link + verify", () => {
  it("magic-link 202 { sent:true }, dev token only when flag set", async () => {
    const off = await app.request(
      "/api/v1/auth/magic-link",
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email: "a@b.com" }) },
      makeEnv(),
    );
    expect(off.status).toBe(202);
    expect(await off.json()).toEqual({ sent: true });

    const on = await app.request(
      "/api/v1/auth/magic-link",
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email: "a@b.com" }) },
      { ...makeEnv(), IHL_DEV_EXPOSE_MAGIC_TOKEN: "1" },
    );
    const body = (await on.json()) as { sent: boolean; dev_magic_token?: string };
    expect(body.sent).toBe(true);
    expect(typeof body.dev_magic_token).toBe("string");
  });

  it("magic-link rejects bad email → 400", async () => {
    const res = await app.request(
      "/api/v1/auth/magic-link",
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email: "not-an-email" }) },
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("verify issues session + HttpOnly;Secure;SameSite=Lax cookie", async () => {
    const { setCookie, actorId } = await login("user@example.com");
    expect(actorId).toBe(await deriveActorId("user@example.com"));
    expect(setCookie).toContain("ihl_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toContain("Max-Age=2592000"); // 30 days
  });

  it("email case/whitespace variants → same actor_id (第6回裁定③)", async () => {
    const a = await login("  User@Example.COM  ");
    const b = await login("user@example.com");
    expect(a.actorId).toBe(b.actorId);
  });
});

describe("C2 auth — negative (tamper / expiry / purpose)", () => {
  // V3-AUT-19: a v1.-shaped token that WAS presented but fails verification is
  // INVALID_TOKEN (distinct from AUTH_REQUIRED = no credential presented at all).
  it("tampered token → 401 INVALID_TOKEN", async () => {
    const good = await issueSessionToken(await deriveActorId("x@y.z"), SESSION_SECRET);
    const parts = good.split(".");
    // flip a char in the payload segment
    const badPayload = parts[1].slice(0, -1) + (parts[1].endsWith("A") ? "B" : "A");
    const tampered = `${parts[0]}.${badPayload}.${parts[2]}`;
    expect(await verifySessionToken(tampered, SESSION_SECRET)).toBeNull();
    const res = await app.request("/events", { method: "POST", headers: bearer(tampered) }, makeEnv());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "INVALID_TOKEN" });
  });

  it("wrong secret → 401 INVALID_TOKEN", async () => {
    const foreign = await issueSessionToken(await deriveActorId("x@y.z"), "other-secret");
    const res = await app.request("/events", { method: "POST", headers: bearer(foreign) }, makeEnv());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "INVALID_TOKEN" });
  });

  it("expired token → 401 INVALID_TOKEN", async () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const expired = await signToken({ sub: "abc", iat: past - 60, exp: past }, SESSION_SECRET);
    expect(await verifySessionToken(expired, SESSION_SECRET)).toBeNull();
    const res = await app.request("/events", { method: "POST", headers: bearer(expired) }, makeEnv());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "INVALID_TOKEN" });
  });

  it("purpose mixing: magic token cannot authenticate a session → 401 INVALID_TOKEN", async () => {
    const magic = await issueMagicToken("user@example.com", SESSION_SECRET);
    expect(await verifySessionToken(magic, SESSION_SECRET)).toBeNull();
    const res = await app.request("/events", { method: "POST", headers: bearer(magic) }, makeEnv());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "INVALID_TOKEN" });
  });

  it("verify with a session token (wrong purpose) → 401", async () => {
    const session = await issueSessionToken("abc", SESSION_SECRET);
    const res = await app.request(
      "/api/v1/auth/verify",
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ token: session }) },
      makeEnv(),
    );
    expect(res.status).toBe(401);
  });
});

describe("C2 auth — session state + middleware paths", () => {
  it("GET /session: false without cookie, true with", async () => {
    const anon = await app.request("/api/v1/auth/session", {}, makeEnv());
    expect(anon.status).toBe(200);
    expect(await anon.json()).toEqual({ authenticated: false });

    const { cookie, actorId } = await login("user@example.com");
    const authed = await app.request("/api/v1/auth/session", { headers: { Cookie: cookie } }, makeEnv());
    expect(await authed.json()).toEqual({ authenticated: true, actor_id: actorId, onboarding_complete: false });
  });

  it("cookie authenticates a protected write", async () => {
    const { cookie } = await login("user@example.com");
    const res = await app.request(
      "/events",
      { method: "POST", headers: { Cookie: cookie, ...JSON_HEADERS }, body: JSON.stringify(makeEnvelope()) },
      makeEnv(),
    );
    expect(res.status).toBe(201);
  });

  it("DEV_TOKEN bearer → actorId = deriveActorId('dev@ihl.local')", async () => {
    const res = await app.request(
      "/events",
      { method: "POST", headers: { Authorization: "Bearer test-dev-token", ...JSON_HEADERS }, body: JSON.stringify(makeEnvelope()) },
      makeEnv(),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { actor_id: string };
    expect(body.actor_id).toBe(await deriveActorId("dev@ihl.local"));
  });

  it("V3-AUT-05: POST /dev-login mints a session cookie for the fixed dev actor", async () => {
    const res = await app.request(
      "/api/v1/auth/dev-login",
      { method: "POST", headers: JSON_HEADERS },
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const devActor = await deriveActorId("dev@ihl.local");
    expect(await res.json()).toEqual({ actor_id: devActor });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^ihl_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    // The minted cookie authenticates a protected write as the dev actor.
    const cookie = setCookie.split(";")[0];
    const write = await app.request(
      "/events",
      { method: "POST", headers: { Cookie: cookie, ...JSON_HEADERS }, body: JSON.stringify(makeEnvelope()) },
      makeEnv(),
    );
    expect(write.status).toBe(201);
    expect(((await write.json()) as { actor_id: string }).actor_id).toBe(devActor);
  });

  it("V3-AUT-05/V3-AUT-10: dev-login's seeded handle+locale satisfies the SAME onboarding SSOT middleware reads (regression guard: account.ts must read the pref-set handle dev-login actually writes, not the separate /me/handle claim)", async () => {
    const env = makeEnv(); // same bucket for both requests — onboarding state must persist
    const res = await app.request("/api/v1/auth/dev-login", { method: "POST", headers: JSON_HEADERS }, env);
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
    const sess = await app.request("/api/v1/auth/session", { headers: { Cookie: cookie } }, env);
    expect((await sess.json()) as { onboarding_complete: boolean }).toMatchObject({ onboarding_complete: true });
  });

  it("V3-AUT-05: /dev-login is 404 in prod (DEV_TOKEN unset) — no prod surface", async () => {
    const res = await app.request(
      "/api/v1/auth/dev-login",
      { method: "POST", headers: JSON_HEADERS },
      { ...makeEnv(), DEV_TOKEN: undefined },
    );
    expect(res.status).toBe(404);
  });

  it("V3-AUT-17: STORED envelope provenance.actor_id === session principal (Bearer session)", async () => {
    const email = "writer@example.com";
    const actorId = await deriveActorId(email);
    const session = await issueSessionToken(actorId, SESSION_SECRET);
    const bucket = new FakeR2Bucket();
    const res = await app.request(
      "/events",
      { method: "POST", headers: bearer(session), body: JSON.stringify(makeEnvelope()) },
      makeEnv(bucket),
    );
    expect(res.status).toBe(201);
    const { key, actor_id } = (await res.json()) as { key: string; actor_id: string };
    expect(actor_id).toBe(actorId); // response echo
    // Assert the PERSISTED record, not just the echo — this is what V3-AUT-17 protects.
    const stored = JSON.parse(String(bucket.objects.get(key)!.body));
    expect(stored.provenance.actor_id).toBe(actorId);
  });

  it("V3-AUT-17: client-forged provenance.actor_id is OVERWRITTEN with the session principal", async () => {
    const actorId = await deriveActorId("owner@example.com");
    const session = await issueSessionToken(actorId, SESSION_SECRET);
    const forged = makeEnvelope({
      provenance: { generator_kind: "human", actor_id: "victim-forged-actor-id" },
    });
    const bucket = new FakeR2Bucket();
    const res = await app.request(
      "/events",
      { method: "POST", headers: bearer(session), body: JSON.stringify(forged) },
      makeEnv(bucket),
    );
    expect(res.status).toBe(201);
    const { key } = (await res.json()) as { key: string };
    const stored = JSON.parse(String(bucket.objects.get(key)!.body));
    // The forged actor_id must NOT survive to Truth.
    expect(stored.provenance.actor_id).toBe(actorId);
    expect(stored.provenance.actor_id).not.toBe("victim-forged-actor-id");
  });

  it("logout clears cookie (Max-Age=0) and is protected", async () => {
    const anon = await app.request("/api/v1/auth/logout", { method: "POST" }, makeEnv());
    expect(anon.status).toBe(401); // protected: needs a session

    const { cookie } = await login("user@example.com");
    const res = await app.request(
      "/api/v1/auth/logout",
      { method: "POST", headers: { Cookie: cookie } },
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toMatch(/Max-Age=0/i);
  });
});
