// V3-AIP-95 — AI推論モードフラグ(design35 §3 A-3・発注書 w-fnd2)。
// ★既定は必ず stub — CIが通常運転でprod(課金経路)を叩かないことを保証する。
import { describe, expect, it } from "vitest";
import { resolveAiMode } from "../apps/api/src/env";

describe("V3-AIP-95 resolveAiMode", () => {
  it("defaults to stub when AI_MODE is unset (CI must never force prod)", () => {
    expect(resolveAiMode({})).toBe("stub");
  });

  it("defaults to stub for any value other than the literal 'prod'", () => {
    expect(resolveAiMode({ AI_MODE: "" })).toBe("stub");
    expect(resolveAiMode({ AI_MODE: "PROD" })).toBe("stub"); // 大文字小文字違いもstub側へ倒す
    expect(resolveAiMode({ AI_MODE: "production" })).toBe("stub");
    expect(resolveAiMode({ AI_MODE: "stub" })).toBe("stub");
  });

  it("only the exact literal 'prod' switches to prod (explicit opt-in)", () => {
    expect(resolveAiMode({ AI_MODE: "prod" })).toBe("prod");
  });
});
