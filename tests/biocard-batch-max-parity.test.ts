// 2026-08-08 order-2026-08-08-w1-fixups T3(G-04-1是正): apps/web は apps/api を直import
// できない構成(scripts/lint-deps.mjs)のため、BIO_CARD_BATCH_MAX は web 側にも複製定義
// (apps/web/src/renderer/zones/ind-screens/card-batch-limits.ts)している。二重化した
// 定数がずれないことをこのテストで固定する。
import { describe, expect, it } from "vitest";
import { BIO_CARD_BATCH_MAX } from "../apps/api/src/observation-constants";
import { BIO_CARD_BATCH_MAX_WEB } from "../apps/web/src/renderer/zones/ind-screens/card-batch-limits";

describe("biocard batch max parity (api <-> web)", () => {
  it("web側の複製定数はapi側の値と一致する", () => {
    expect(BIO_CARD_BATCH_MAX_WEB).toBe(BIO_CARD_BATCH_MAX);
  });
});
