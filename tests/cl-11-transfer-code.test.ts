// CL-11: GMO deriveTransferCode(userId) — schemas/frozen/transfer-code.schema.json
// + fixtures/cl-11-transfer-code-vectors.json (real ver2 derive_transfer_code run).
// ONE vector mismatch = fail: 導出関数が変わると既存ユーザーの入金照合が破綻する。
import { describe, expect, it } from "vitest";
import { deriveTransferCode, validateFrozen } from "@ihl/truth";
import { loadFixture } from "./helpers";

type Vector = { user_id: string; transfer_code: string };
const fixture = loadFixture<{ vectors: Vector[] }>(
  "cl-11-transfer-code-vectors.json",
);

describe("CL-11 deriveTransferCode", () => {
  it("matches ALL ver2 vectors exactly (incl. empty / unicode / long ids)", async () => {
    for (const v of fixture.vectors) {
      const got = await deriveTransferCode(v.user_id);
      expect(got, `user_id=${JSON.stringify(v.user_id)}`).toBe(
        v.transfer_code,
      );
    }
  });

  it("every derived code satisfies the frozen shape U-[0-9A-Z]{4,6}", async () => {
    for (const v of fixture.vectors) {
      const code = await deriveTransferCode(v.user_id);
      expect(validateFrozen("transfer-code", { transfer_code: code }).valid, code).toBe(
        true,
      );
    }
  });

  it.each([
    "IHL-EXAMPLE-8PCT", // GMO stub demo value — NOT a derive output
    "u-94z5o", // lowercase forbidden
    "U-ABC", // too short (zfill(4) guarantees >= 4)
    "U-1234567", // longer than uint24 Base36 can produce
    "94Z5O", // missing U- prefix
  ])("rejects malformed transfer_code %s", (code) => {
    expect(validateFrozen("transfer-code", { transfer_code: code }).valid).toBe(
      false,
    );
  });

  it("rejects a record missing transfer_code", () => {
    expect(validateFrozen("transfer-code", {}).valid).toBe(false);
  });
});
