// V3-SEC-04 — secret-leak GATE. scanText detects PEM private-key blocks and
// Resend / OpenAI / AWS key shapes, and does NOT false-positive on the type-only
// placeholder (all-x re_xxxx…) that lives in .env.example.
import { describe, expect, it } from "vitest";
import { scanText } from "../scripts/check-secrets.mjs";

describe("V3-SEC-04 scanText(secret shapes)", () => {
  it("detects a PEM private-key block", () => {
    const text = "-----BEGIN PRIVATE KEY-----\nMIIBVAIBADANBgkqhkiG9w0BAQEFAA\n-----END PRIVATE KEY-----";
    expect(scanText(text)).toContain("PEM_PRIVATE_KEY");
  });

  it("detects Resend / OpenAI / AWS key shapes", () => {
    expect(scanText("token re_abcdef0123456789ABCDEF here")).toContain("RESEND_KEY");
    expect(scanText("token sk-abcdef0123456789ABCDEF here")).toContain("OPENAI_KEY");
    expect(scanText("token AKIA1234567890ABCDEF here")).toContain("AWS_ACCESS_KEY");
  });

  it("does not false-positive on the .env.example placeholder (all-x re_xxxx…)", () => {
    expect(scanText("RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxx")).toEqual([]);
    expect(scanText("clean config with no secrets")).toEqual([]);
  });
});
