// MKT-14 GMO webhook 受信の検証 + parse(関数のみ・route 未配線)。実 webhook 受信 /
// GMO_CONNECTOR_MODE=live / 実入金消込確定は人間ゲート(金銭・実鍵)。ここは
// verifyGmoWebhookHmac(P1 hmac.ts 再利用)と正規化 parse を提供し、TC で正/改竄/冪等
// dedup を固める(design-k3 §2.5・§6)。route への配線はゲート通過後の別波。
import { verifyHmacSha256 } from "./hmac";
import { parseTransactions } from "./gmo-connector";

/** GMO webhook の署名検証。GMO は SHA-256 HMAC を raw hex で送る(GitHub の sha256=
 *  prefix にも hmac.ts が耐える)。署名がクレデンシャル=検証成立が受理条件。 */
export async function verifyGmoWebhookHmac(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
): Promise<boolean> {
  return verifyHmacSha256(rawBody, signatureHeader, secret);
}

/** 正規化した webhook 通知 1 件。dedup_key は put-if-absent の冪等キー(同一通知の
 *  再送は同じ dedup_key → route 配線時に 409 で二重消込を防ぐ)。 */
export interface GmoWebhookNotification {
  dedup_key: string;
  item_key: string;
  amount: number;
  applicant_name: string;
  transaction_date: string;
}

/** raw JSON を GmoWebhookNotification へ。単一通知/{transactions:[...]} 双方を受ける
 *  (gmo-connector の防御的パース再利用)。不正/入金なしは null。 */
export function parseGmoWebhook(rawBody: string): GmoWebhookNotification | null {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const wrapped =
    json && typeof json === "object" && Array.isArray((json as { transactions?: unknown }).transactions)
      ? json
      : { transactions: [json] };
  const first = parseTransactions(wrapped)[0];
  if (!first) return null;
  const notificationId = (json as { notificationId?: unknown })?.notificationId;
  const dedup = typeof notificationId === "string" && notificationId ? notificationId : first.itemKey;
  return {
    dedup_key: dedup,
    item_key: first.itemKey,
    amount: first.amount,
    applicant_name: first.applicantName,
    transaction_date: first.transactionDate,
  };
}
