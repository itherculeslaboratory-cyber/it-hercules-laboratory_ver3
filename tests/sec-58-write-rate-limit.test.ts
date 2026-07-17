// V3-SEC-58: 書込系(R2 Truth)レート制限+ユーザー別クォータ。index.ts の単一 choke-point
// middleware(deny-by-default 直後)を実 app.request 経由で検証する。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { memoryKV } from "../apps/api/src/kv";
import { AUTH_HEADERS, makeEnv } from "./helpers";

function envWithRateLimit() {
  return { ...makeEnv(), RATE_LIMIT: memoryKV() };
}

describe("V3-SEC-58 write rate limit + quota", () => {
  it("RATE_LIMIT unbound (existing tests' makeEnv()) never rate-limits (no-op degrade)", async () => {
    const env = makeEnv();
    for (let i = 0; i < 5; i++) {
      const res = await app.request(
        "/api/v1/match/preference",
        { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ item_id: `i${i}`, kind: "swipe", y: 1, features: [1] }) },
        env,
      );
      expect(res.status).toBe(201);
    }
  });

  it("GET requests are never rate-limited (read paths untouched)", async () => {
    const env = envWithRateLimit();
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/api/v1/me/preferences", { headers: AUTH_HEADERS }, env);
      expect(res.status).toBe(200);
    }
  });

  it("exceeding the per-minute write limit returns 429 RATE_LIMITED", async () => {
    const env = envWithRateLimit();
    const post = (i: number) =>
      app.request(
        "/api/v1/match/preference",
        { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ item_id: `i${i}`, kind: "swipe", y: 1, features: [1] }) },
        env,
      );
    // WRITE_RATE_LIMIT_PER_MINUTE = 60 — the 61st write in the same minute bucket 429s.
    let lastStatus = 0;
    for (let i = 0; i < 61; i++) {
      lastStatus = (await post(i)).status;
    }
    expect(lastStatus).toBe(429);
    const body = (await (await post(999)).json()) as { error: string };
    expect(body.error).toBe("RATE_LIMITED");
  });
});
