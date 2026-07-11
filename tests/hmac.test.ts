// V3-KRM-13 / V3-MKT-14 shared HMAC-SHA256 webhook verification.
// Vector is RFC 4231 Test Case 2 (a published, independent value — NOT computed
// by the function under test, so a broken sign path can't self-validate):
//   key  = "Jefe"
//   data = "what do ya want for nothing?"
//   HMAC-SHA256 = 5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843
import { describe, expect, it } from "vitest";
import { verifyHmacSha256 } from "../apps/api/src/hmac";

const SECRET = "Jefe";
const BODY = "what do ya want for nothing?";
const SIG = "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843";

describe("verifyHmacSha256", () => {
  it("accepts a valid signature with GitHub sha256= prefix", async () => {
    expect(await verifyHmacSha256(BODY, `sha256=${SIG}`, SECRET)).toBe(true);
  });

  it("accepts a valid signature as raw hex (GMO)", async () => {
    expect(await verifyHmacSha256(BODY, SIG, SECRET)).toBe(true);
  });

  it("rejects a tampered signature", async () => {
    const tampered = SIG.slice(0, -1) + (SIG.endsWith("3") ? "4" : "3");
    expect(await verifyHmacSha256(BODY, `sha256=${tampered}`, SECRET)).toBe(false);
  });

  it("rejects a tampered body (same signature)", async () => {
    expect(await verifyHmacSha256(`${BODY} `, `sha256=${SIG}`, SECRET)).toBe(false);
  });

  it("rejects a wrong secret", async () => {
    expect(await verifyHmacSha256(BODY, `sha256=${SIG}`, "wrong")).toBe(false);
  });

  it("rejects missing/empty/malformed signature header", async () => {
    expect(await verifyHmacSha256(BODY, null, SECRET)).toBe(false);
    expect(await verifyHmacSha256(BODY, "", SECRET)).toBe(false);
    expect(await verifyHmacSha256(BODY, "sha256=nothexvalue!!", SECRET)).toBe(false);
    expect(await verifyHmacSha256(BODY, "sha256=abc", SECRET)).toBe(false); // odd length
  });

  it("rejects when secret is empty", async () => {
    expect(await verifyHmacSha256(BODY, `sha256=${SIG}`, "")).toBe(false);
  });
});
