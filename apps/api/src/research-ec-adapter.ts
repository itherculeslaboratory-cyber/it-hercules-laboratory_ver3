// V3-MKT-45 外部EC(BASE/Shopify)アダプタ。実鍵は本ランに存在しない(costs-routes.ts
// fetchR2Usage と同じ縮退規約)ため、資格情報が env に無ければ即 undefined を返し
// (ネットワーク呼び出しなし)、実疎通は本番鍵投入後の人間ゲート後続とする。呼び出し側
// (research-store-routes.ts)は在庫同期の成否に関わらず注文自体は成立させる(在庫同期は
// あくまで外部表示の追従であり、注文成立の必須条件にしない=外部APIの不調で内部の
// 在庫チェック済み注文をブロックしない)。
export interface ExternalEcEnv {
  BASE_EC_API_KEY?: string;
  SHOPIFY_EC_API_KEY?: string;
}

export interface ExternalStockSyncResult {
  synced: boolean;
  provider?: "base" | "shopify";
  reason?: string;
}

/** ponytail: 実 BASE/Shopify API 呼び出しは実鍵疎通後の後続(人間ゲート: 実鍵投入)。
 * ここでは「鍵が無ければ呼ばない」縮退のみを実装し、呼び出し形状(seam)だけ用意する。 */
export async function syncExternalStock(
  env: ExternalEcEnv,
  _item: { item_id: string; external_ec_url?: string },
): Promise<ExternalStockSyncResult> {
  if (env.BASE_EC_API_KEY) return { synced: false, provider: "base", reason: "live sync not implemented (human gate: real key wiring)" };
  if (env.SHOPIFY_EC_API_KEY) return { synced: false, provider: "shopify", reason: "live sync not implemented (human gate: real key wiring)" };
  return { synced: false, reason: "no external EC credentials configured" };
}
