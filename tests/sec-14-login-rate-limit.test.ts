// V3-SEC-14: ログイン系エンドポイントのレート制限(magiclink 20回/60秒/IP、verify 60回/60秒/IP)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { memoryKV } from "../apps/api/src/kv";
import { makeEnv } from "./helpers";

function envWithRateLimit() {
  return { ...makeEnv(), RATE_LIMIT: memoryKV() };
}

describe("V3-SEC-14 login endpoint rate limiting", () => {
  it("RATE_LIMIT unbound never rate-limits (existing auth.test.ts makeEnv() unaffected)", async () => {
    const env = makeEnv();
    for (let i = 0; i < 3; i++) {
      const res = await app.request(
        "/api/v1/auth/magic-link",
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "x@example.com" }) },
        env,
      );
      expect(res.status).toBe(202);
    }
  });

  it("POST /magic-link 429s after 20 requests/IP/60s", async () => {
    const env = envWithRateLimit();
    const headers = { "content-type": "application/json", "CF-Connecting-IP": "203.0.113.5" };
    const send = () =>
      app.request(
        "/api/v1/auth/magic-link",
        { method: "POST", headers, body: JSON.stringify({ email: "x@example.com" }) },
        env,
      );
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await send()).status;
    expect(last).toBe(429);
  });

  it("different IPs are independent buckets", async () => {
    const env = envWithRateLimit();
    const sendFrom = (ip: string) =>
      app.request(
        "/api/v1/auth/magic-link",
        { method: "POST", headers: { "content-type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify({ email: "x@example.com" }) },
        env,
      );
    for (let i = 0; i < 20; i++) expect((await sendFrom("198.51.100.1")).status).toBe(202);
    expect((await sendFrom("198.51.100.1")).status).toBe(429); // 21st from same IP
    expect((await sendFrom("198.51.100.2")).status).toBe(202); // fresh IP unaffected
  });

  it("POST /verify 429s after 60 requests/IP/60s (invalid token still counted before auth check)", async () => {
    const env = envWithRateLimit();
    const headers = { "content-type": "application/json", "CF-Connecting-IP": "203.0.113.9" };
    const send = () =>
      app.request(
        "/api/v1/auth/verify",
        { method: "POST", headers, body: JSON.stringify({ token: "bogus" }) },
        env,
      );
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await send()).status;
    expect(last).toBe(429);
  });
});
