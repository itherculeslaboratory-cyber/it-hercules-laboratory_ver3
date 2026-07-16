// L-PAY: PAY.JP 決済コネクタ TC (round-16 裁定・payjp-connector.ts)。charge の防御的
// パース + webhook 本文からの charge id 抽出(署名なし前提・信用しない) + 接続層分離
// (live は人間ゲートまで throw)。実 PAY.JP API への疎通はしない(実鍵投入は人間ゲート)。
import { describe, expect, it } from "vitest";
import { makePayjpConnector, parseCharge, parseChargeIdFromWebhook } from "../apps/api/src/payjp-connector";

describe("parseCharge(PAY.JP /v1/charges/:id 生レスポンスの防御的パース)", () => {
  it("正常な charge オブジェクトを抽出(paid/captured/metadata含む)", () => {
    const raw = {
      id: "ch_123",
      amount: 500,
      currency: "jpy",
      paid: true,
      captured: true,
      metadata: { obligation_id: "OBL-1", ignored: 42 },
    };
    expect(parseCharge(raw)).toEqual({
      id: "ch_123",
      amount: 500,
      currency: "jpy",
      paid: true,
      captured: true,
      metadata: { obligation_id: "OBL-1" }, // 非文字列値は除外(防御的)
    });
  });

  it("id 欠如 / null は null", () => {
    expect(parseCharge({ amount: 1 })).toBeNull();
    expect(parseCharge(null)).toBeNull();
  });

  it("metadata 欠如・未払い(paid=false)も安全に既定値で埋める", () => {
    expect(parseCharge({ id: "ch_2" })).toEqual({
      id: "ch_2",
      amount: 0,
      currency: "jpy",
      paid: false,
      captured: false,
      metadata: {},
    });
  });
});

describe("parseChargeIdFromWebhook(署名なし前提・charge id だけを信用する)", () => {
  it("PAY.JP event 形状(data.object.id)から charge id を抽出", () => {
    const body = JSON.stringify({ id: "evt_1", type: "charge.succeeded", data: { object: { id: "ch_abc", amount: 999999 } } });
    expect(parseChargeIdFromWebhook(body)).toBe("ch_abc");
  });

  it("不正 JSON / charge id 欠如 / 不正形状の id は null", () => {
    expect(parseChargeIdFromWebhook("not json")).toBeNull();
    expect(parseChargeIdFromWebhook(JSON.stringify({ data: { object: {} } }))).toBeNull();
    expect(parseChargeIdFromWebhook(JSON.stringify({ data: { object: { id: "../../etc/passwd" } } }))).toBeNull();
  });
});

describe("接続層分離(PAYJP_MODE)", () => {
  it("live は人間ゲートまで明示 throw", async () => {
    const c = makePayjpConnector({ PAYJP_MODE: "live" });
    expect(c.mode).toBe("live");
    await expect(c.getCharge("ch_1")).rejects.toThrow(/live connector not implemented/);
  });
  it("test は既定モード・秘密鍵欠如で throw(実 HTTP は張らない)", async () => {
    const c = makePayjpConnector({ PAYJP_MODE: "test" });
    expect(c.mode).toBe("test");
    await expect(c.getCharge("ch_1")).rejects.toThrow(/missing PAYJP_SECRET_KEY/);
  });
  it("PAYJP_MODE 未指定は test 既定", () => {
    expect(makePayjpConnector({}).mode).toBe("test");
  });
  it("未知モードは throw", () => {
    expect(() => makePayjpConnector({ PAYJP_MODE: "bogus" })).toThrow(/unknown PAYJP_MODE/);
  });
});
