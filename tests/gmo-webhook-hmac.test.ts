// MKT-14 GMO webhook 検証 + parse(route 未配線=関数 + TC まで・実受信/live/実入金確定は
// 人間ゲート)。verifyGmoWebhookHmac の正/改竄と、再送二重防止のための冪等 dedup_key。
import { describe, expect, it } from "vitest";
import { verifyGmoWebhookHmac, parseGmoWebhook } from "../apps/api/src/gmo-webhook";

const SECRET = "gmo-webhook-secret";

// テスト内で raw body に対する正規署名を生成(verify 側の crypto は hmac.test.ts が
// 独立ベクタで確認済み — ここは wrapper 配線 + parse を固める)。
async function signHex(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const NOTE = JSON.stringify({
  notificationId: "N-001",
  transactions: [
    { itemKey: "IK-100", transactionType: "1", amount: 1200, remitterName: "U-AB12 テスト", transactionDate: "2026-07-11" },
  ],
});

describe("MKT-14 verifyGmoWebhookHmac", () => {
  it("正しい署名を受理", async () => {
    const sig = await signHex(NOTE, SECRET);
    expect(await verifyGmoWebhookHmac(NOTE, sig, SECRET)).toBe(true);
    expect(await verifyGmoWebhookHmac(NOTE, `sha256=${sig}`, SECRET)).toBe(true);
  });
  it("改竄署名/改竄 body/誤 secret を拒否", async () => {
    const sig = await signHex(NOTE, SECRET);
    const tampered = sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0");
    expect(await verifyGmoWebhookHmac(NOTE, tampered, SECRET)).toBe(false);
    expect(await verifyGmoWebhookHmac(`${NOTE} `, sig, SECRET)).toBe(false);
    expect(await verifyGmoWebhookHmac(NOTE, sig, "wrong")).toBe(false);
    expect(await verifyGmoWebhookHmac(NOTE, null, SECRET)).toBe(false);
  });
});

describe("MKT-14 parseGmoWebhook + 冪等 dedup", () => {
  it("入金通知を正規化(依頼人名/金額/明細キー)", () => {
    const n = parseGmoWebhook(NOTE);
    expect(n).toMatchObject({ item_key: "IK-100", amount: 1200, applicant_name: "U-AB12 テスト" });
  });

  it("再送は同じ dedup_key(put-if-absent 配線時に二重消込を防ぐ)", () => {
    const a = parseGmoWebhook(NOTE);
    const b = parseGmoWebhook(NOTE); // 同一通知の再送
    expect(a?.dedup_key).toBe("N-001");
    expect(a?.dedup_key).toBe(b?.dedup_key);
  });

  it("notificationId 無しは itemKey を dedup_key に採用", () => {
    const raw = JSON.stringify({ transactions: [{ itemKey: "IK-9", transactionType: "1", amount: 500, remitterName: "U-ZZ99" }] });
    expect(parseGmoWebhook(raw)?.dedup_key).toBe("IK-9");
  });

  it("単一通知オブジェクト(transactions ラップ無し)も受ける", () => {
    const raw = JSON.stringify({ itemKey: "IK-7", transactionType: "1", amount: 300, remarks: "振込 U-AB12" });
    const n = parseGmoWebhook(raw);
    expect(n).toMatchObject({ item_key: "IK-7", amount: 300 });
  });

  it("不正 JSON / 入金なしは null", () => {
    expect(parseGmoWebhook("not json")).toBeNull();
    expect(parseGmoWebhook(JSON.stringify({ transactions: [] }))).toBeNull();
    expect(parseGmoWebhook(JSON.stringify({ transactions: [{ itemKey: "X", transactionType: "2", amount: 1 }] }))).toBeNull(); // 出金
  });
});
