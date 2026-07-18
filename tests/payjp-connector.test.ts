// L-PAY: PAY.JP 決済コネクタ TC (round-16 裁定・payjp-connector.ts)。charge の防御的
// パース + webhook 本文からの charge id 抽出(署名なし前提・信用しない) + 接続層分離
// (live は人間ゲートまで throw)。実 PAY.JP API への疎通はしない(実鍵投入は人間ゲート)。
import { describe, expect, it } from "vitest";
import {
  makePayjpConnector,
  parseCharge,
  parseChargeIdFromWebhook,
  platformFeeFor,
  buildTenantForm,
  parseTenant,
  buildPlatformChargeForm,
  parsePlatformCharge,
  type CreateTenantParams,
} from "../apps/api/src/payjp-connector";

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

describe("PAY.JP Platform(Payouts型)test-mode 配線(V3-MKT-62/63)", () => {
  const validTenant: CreateTenantParams = {
    id: "ten_1",
    name: "seller",
    platformFeeRate: 0.05,
    minimumTransferAmount: 100,
    bankAccountHolderName: "ホルダー",
    bankCode: "0001",
    bankBranchCode: "001",
    bankAccountType: "普通",
    bankAccountNumber: "1234567",
  };

  it("platformFeeFor: SETTLEMENT_ACCRUAL_RATE(5%)で四捨五入", () => {
    expect(platformFeeFor(500)).toBe(25);
    expect(platformFeeFor(1000)).toBe(50);
  });

  it("buildTenantForm: 正常値でフォーム構築", () => {
    expect(buildTenantForm(validTenant)).toEqual({
      id: "ten_1",
      name: "seller",
      platform_fee_rate: "0.05",
      minimum_transfer_amount: "100",
      bank_account_holder_name: "ホルダー",
      bank_code: "0001",
      bank_branch_code: "001",
      bank_account_type: "普通",
      bank_account_number: "1234567",
    });
  });

  it("buildTenantForm: 不正 id / 範囲外 platform_fee_rate は throw", () => {
    expect(() => buildTenantForm({ ...validTenant, id: "../x" })).toThrow(/invalid shape/);
    expect(() => buildTenantForm({ ...validTenant, platformFeeRate: 0.99 })).toThrow(/out of range/);
  });

  it("parseTenant: id があれば抽出・欠如/null は null", () => {
    expect(parseTenant({ id: "ten_1", name: "seller", platform_fee_rate: 0.05 })).toEqual({
      id: "ten_1",
      name: "seller",
      platform_fee_rate: 0.05,
    });
    expect(parseTenant({})).toBeNull();
    expect(parseTenant(null)).toBeNull();
  });

  it("buildPlatformChargeForm: platform_fee 込みでフォーム構築・既定 currency=jpy", () => {
    expect(buildPlatformChargeForm({ amount: 500, card: "tok_x", tenant: "ten_1" })).toEqual({
      amount: "500",
      currency: "jpy",
      card: "tok_x",
      tenant: "ten_1",
      platform_fee: "25",
    });
  });

  it("buildPlatformChargeForm: amount<=0 / tenant 空は throw", () => {
    expect(() => buildPlatformChargeForm({ amount: 0, card: "tok_x", tenant: "ten_1" })).toThrow(/amount must be > 0/);
    expect(() => buildPlatformChargeForm({ amount: 500, card: "tok_x", tenant: "" })).toThrow(/tenant is required/);
  });

  it("parsePlatformCharge: 基底 charge + platform フィールドを抽出", () => {
    const raw = {
      id: "ch_1",
      amount: 500,
      currency: "jpy",
      paid: true,
      captured: true,
      metadata: {},
      tenant: "ten_1",
      platform_fee: 25,
      platform_fee_rate: 0.05,
      total_platform_fee: 25,
    };
    expect(parsePlatformCharge(raw)).toEqual({
      id: "ch_1",
      amount: 500,
      currency: "jpy",
      paid: true,
      captured: true,
      metadata: {},
      tenant: "ten_1",
      platform_fee: 25,
      platform_fee_rate: 0.05,
      total_platform_fee: 25,
    });
  });

  it("parsePlatformCharge: 基底 charge の id 欠如は null", () => {
    expect(parsePlatformCharge({ platform_fee: 25 })).toBeNull();
  });

  it("live は createTenant/createPlatformCharge も人間ゲートまで throw", async () => {
    const c = makePayjpConnector({ PAYJP_MODE: "live" });
    await expect(c.createTenant(validTenant)).rejects.toThrow(/live connector not implemented/);
    await expect(c.createPlatformCharge({ amount: 500, card: "tok_x", tenant: "ten_1" })).rejects.toThrow(
      /live connector not implemented/,
    );
  });

  it("test は秘密鍵欠如で createTenant/createPlatformCharge も throw(実 HTTP は張らない)", async () => {
    const c = makePayjpConnector({ PAYJP_MODE: "test" });
    await expect(c.createTenant(validTenant)).rejects.toThrow(/missing PAYJP_SECRET_KEY/);
    await expect(c.createPlatformCharge({ amount: 500, card: "tok_x", tenant: "ten_1" })).rejects.toThrow(
      /missing PAYJP_SECRET_KEY/,
    );
  });
});
