// PAY.JP 決済コネクタ(round-16 裁定・docs/planning/rulings/round-16-answers-raw.md 受領1〜7・
// docs/planning/b2-research/research-payjp-platform.md/research-payment-service-scan.md)。
// 5%システム維持費=ゆるい請求ベース(取引成立→計算して振り込んでね・取り逃し許容)の決済手段
// 第一弾。GMO 退役に伴う後継(PayPay OPA は並行申請中で将来追加・本コネクタは不触)。
//
// 接続層を gmo-connector.ts と同じパターンで分離: PAYJP_MODE=test(既定・PAY.JP テスト
// モード秘密鍵 sk_test_...)/live(本番 — 人間ゲート: 実鍵投入・live 昇格までは明示 throw)。
// 秘密鍵は env 経由のみ(実値の読み取り・出力・コミット・ログ混入は禁止・AGENTS.md 禁止事項)。
//
// 本コネクタが提供するのは charge 照会(GET /v1/charges/:id)と webhook 本文からの charge id
// 防御的抽出のみ — charge 作成 API は呼ばない(カードトークンはフロントエンド専有の情報で
// バックエンドは持たない・ゆるい請求は「請求記録を発行するだけ」で決済起動はしない。実際の
// 支払いは利用者が別途 PAY.JP 側で行い、その結果を webhook + 本 API 照会で確認する)。
//
// ── Webhook 検証方針(重要・根拠) ──────────────────────────────────────────
// PAY.JP の Webhook は X-Payjp-Webhook-Token ヘッダを提供するが、GMO/GitHub の HMAC 署名
// (hmac.ts・本文+秘密鍵からの計算値)とは異なり固定トークンの一致確認に留まる — 一次情報
// (docs.pay.jp/v1/webhook)にも署名検証の仕組みとしての明記が薄く、本文改ざん検知にはならない。
// そこで本コネクタは Webhook 本文の amount/metadata を一切信用せず、受信した charge id
// だけを鍵として本 API(GET /v1/charges/:id・Basic 認証=秘密鍵)へ再照会し、PAY.JP が
// 返した正真の charge オブジェクト(paid/amount/metadata)だけを信頼する「2段構え」を採用する
// (実装は fee-routes.ts の POST /fees/payjp-webhook route)。
export interface PayjpCharge {
  id: string;
  amount: number;
  currency: string;
  paid: boolean;
  captured: boolean;
  metadata: Record<string, string>;
}

export interface PayjpConnector {
  readonly mode: string;
  /** charge id で GET /v1/charges/:id を照会。存在しない(404)は null。 */
  getCharge(chargeId: string): Promise<PayjpCharge | null>;
}

export interface PayjpEnv {
  PAYJP_MODE?: string;
  PAYJP_SECRET_KEY?: string;
  PAYJP_API_BASE?: string;
}

const DEFAULT_API_BASE = "https://api.pay.jp/v1";

// charge id の許容形状(PAY.JP は "ch_" prefix の英数字)。外部入力の無害化・URL 注入防止。
function safeChargeId(id: string): boolean {
  return /^[A-Za-z0-9_]{1,255}$/.test(id);
}

/** PAY.JP /v1/charges/:id の生レスポンス → PayjpCharge へ防御的パース。不正形状は null。 */
export function parseCharge(raw: unknown): PayjpCharge | null {
  const c = raw as Record<string, unknown> | null;
  if (!c || typeof c.id !== "string") return null;
  const rawMeta = c.metadata && typeof c.metadata === "object" ? (c.metadata as Record<string, unknown>) : {};
  const metadata: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawMeta)) if (typeof v === "string") metadata[k] = v;
  return {
    id: c.id,
    amount: typeof c.amount === "number" ? c.amount : 0,
    currency: typeof c.currency === "string" ? c.currency : "jpy",
    paid: c.paid === true,
    captured: c.captured === true,
    metadata,
  };
}

/**
 * PAY.JP webhook 本文(event オブジェクト・{data:{object:{id,...}}} 形)から charge id だけを
 * 防御的に抽出する。振込・金額・metadata 等 charge id 以外のフィールドはここでは一切使わない
 * (署名なし前提のため信用しない — 真正性確認は getCharge() の再照会に一本化)。
 */
export function parseChargeIdFromWebhook(rawBody: string): string | null {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const obj = (json as { data?: { object?: { id?: unknown } } })?.data?.object;
  const id = obj?.id;
  return typeof id === "string" && safeChargeId(id) ? id : null;
}

export function makePayjpConnector(env: PayjpEnv): PayjpConnector {
  const mode = env.PAYJP_MODE ?? "test";

  if (mode === "live") {
    // 本番決済は人間ゲート(実鍵投入・live 昇格)。接続層は分離済み — ゲート通過後に
    // sk_live_ 鍵での同一実装差し替えのみで足りる(test と live は API 形状同一)。
    const throwLive = async (): Promise<never> => {
      throw new Error(
        "PAY.JP live connector not implemented — 本番接続は人間ゲート(実鍵投入/live 昇格)",
      );
    };
    return { mode, getCharge: throwLive };
  }
  if (mode !== "test") throw new Error(`unknown PAYJP_MODE: ${mode}`);

  const base = env.PAYJP_API_BASE ?? DEFAULT_API_BASE;
  const secret = env.PAYJP_SECRET_KEY;
  return {
    mode,
    async getCharge(chargeId: string): Promise<PayjpCharge | null> {
      if (!secret) throw new Error("payjp connector missing PAYJP_SECRET_KEY");
      if (!safeChargeId(chargeId)) return null;
      // PAY.JP は Basic 認証(秘密鍵をユーザー名・パスワード空)。
      const res = await fetch(`${base}/charges/${encodeURIComponent(chargeId)}`, {
        headers: { Authorization: `Basic ${btoa(`${secret}:`)}` },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`payjp charges HTTP ${res.status}`);
      return parseCharge(await res.json());
    },
  };
}
