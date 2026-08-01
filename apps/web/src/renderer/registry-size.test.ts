import { describe, it, expect } from "vitest";
import { registrySize } from "./core/registry";
import "./zones/register-all";

// renderer分割Phase 2b(uiplan §1-5 Phase2b④)。9ゾーン×registerNode呼び出し
// の実測合計=23(発注書/uiplan記載の「27」は実測と不一致だったため訂正。
// 内訳: obs-batch4 + search4 + ind-profile2 + thread-posts1 + app-shell1 +
// knowledge3 + home1 + knowledge-chat1 + ind-screens6 = 23。訂正の根拠は
// 報告書参照)。
describe("registrySize — Phase 2bカットオーバー後は9ゾーン分が登録される", () => {
  it("registrySize() === 23", () => {
    expect(registrySize()).toBe(23);
  });
});
