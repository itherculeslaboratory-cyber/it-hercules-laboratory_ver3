// V3-MKT-64: カード非保有ユーザー向けプリペイドカード案内。PAY.JP/PayPay の照会結果
// (Platform実配線の可否)に一切依存しない静的な案内文言のみを返す(round-16 HANDOFF §3.3
// 「Platform自動控除は照会回答後」のゲートより手前で出せる非強制ガイダンス)。実際のカード
// 保有判定・3DS通過確認は行わない(PAY.JP側の決済時に利用者自身が確認する)。強制ではなく
// 任意案内(non_mandatory)なので、銀行振込(既定)を選ぶ人には無関係。
import { Hono } from "hono";
import type { Bindings, Variables } from "./env";

export const marketPaymentGuidanceRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

export interface PaymentGuidance {
  applies_to: "payjp_platform_card_option";
  non_mandatory: true;
  options: { label: string; body: string }[];
}

// PAY.JP 公式対応例として言及されるバンドルカード等の Visa プリペイド/バーチャルカード
// (3DS本人認証対応)を静的に案内する。値は固定(照会結果・外部API呼び出し一切なし)。
export const PAYMENT_GUIDANCE: PaymentGuidance = {
  applies_to: "payjp_platform_card_option",
  non_mandatory: true,
  options: [
    {
      label: "バンドルカード等のVisaプリペイド/バーチャルカード",
      body:
        "クレジットカードをお持ちでない場合でも、バンドルカード等の3DS(本人認証)対応プリペイド/バーチャルカードなら" +
        "PAY.JP Platformのカード決済オプションで通常のクレジットカードと同様に利用できます(PAY.JP公式の対応例)。" +
        "銀行振込(既定・無料・本人確認なし)を使う場合はこの案内は不要です。",
    },
  ],
};

// GET /market/payment-guidance — 静的案内(PROTECTED・全ログイン済みユーザーに共通)。
marketPaymentGuidanceRoutes.get("/market/payment-guidance", (c) => c.json(PAYMENT_GUIDANCE));
