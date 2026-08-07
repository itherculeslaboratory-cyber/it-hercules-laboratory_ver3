// V3-MKT-64: カード非保有ユーザー向けプリペイドカード案内(照会結果=PAY.JP/PayPay申込の
// 可否に一切依存しない静的ガイダンス)。GET /market/payment-guidance は PROTECTED(全ログイン
// 済みユーザー共通・本人固有の状態判定は行わない)。
// 2026-08-07裁定: V3-MKT-64退役(V3-MKT-62 Platformオプション撤回に伴い発火条件消滅)。
// route非公開(apps/api/src/index.ts)に追随し、契約テストも退役(ファイルは削除しない)。
// ★vitestは中身が空のテストファイルを「0 test」でFAILさせるため、実装側と同じ全行コメントアウト
// ではなく describe.skip で無効化する(退役の意図は同じ。理由=本ファイル内の本注記)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { AUTH_HEADERS, makeEnv } from "./helpers";

describe.skip("GET /api/v1/market/payment-guidance", () => {
  it("認証なし → 401", async () => {
    const res = await app.request("/api/v1/market/payment-guidance", {}, makeEnv());
    expect(res.status).toBe(401);
  });

  it("非強制の静的プリカ案内を返す(照会結果に依存しない)", async () => {
    const res = await app.request("/api/v1/market/payment-guidance", { headers: AUTH_HEADERS }, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      applies_to: string;
      non_mandatory: boolean;
      options: { label: string; body: string }[];
    };
    expect(body.applies_to).toBe("payjp_platform_card_option");
    expect(body.non_mandatory).toBe(true);
    expect(body.options.length).toBeGreaterThan(0);
    expect(body.options[0].body).toContain("バンドルカード");
  });
});
