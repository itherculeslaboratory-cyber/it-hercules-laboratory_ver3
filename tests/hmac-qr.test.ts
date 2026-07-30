// V3-SEC-44: QR2系統(公開用=既存qr_url プレーンURL・IND所有/観測管理用=本ファイル
// が検証する暗号化+署名)。
import { describe, expect, it } from "vitest";
import {
  generateQrEncryptionKey,
  generateQrSigningKeyPair,
  encryptQrPayload,
  decryptQrPayload,
  buildInternalQrToken,
  openInternalQrToken,
} from "../apps/api/src/hmac-qr";

describe("V3-SEC-44 AES-256-GCM encrypt/decrypt", () => {
  it("暗号化→復号で元payloadが復元される", async () => {
    const key = await generateQrEncryptionKey();
    const payload = { individual_id: "ind-1", kind: "internal" };
    const enc = await encryptQrPayload(payload, key);
    expect(enc.ciphertext_b64).not.toContain("ind-1"); // 暗号文に平文が漏れない
    const decrypted = await decryptQrPayload(enc, key);
    expect(decrypted).toEqual(payload);
  });

  it("異なる鍵での復号は例外(GCMタグ検証失敗)", async () => {
    const key1 = await generateQrEncryptionKey();
    const key2 = await generateQrEncryptionKey();
    const enc = await encryptQrPayload({ a: 1 }, key1);
    await expect(decryptQrPayload(enc, key2)).rejects.toThrow();
  });
});

describe("V3-SEC-44 内部QRトークン(暗号化+Ed25519署名の組み合わせ)", () => {
  it("正当なトークンは署名検証を通り、元payloadを復元する", async () => {
    const encKey = await generateQrEncryptionKey();
    const { privateKey, publicKey } = await generateQrSigningKeyPair();
    const payload = { individual_id: "ind-2", kind: "internal" };
    const token = await buildInternalQrToken(payload, encKey, privateKey);
    const opened = await openInternalQrToken(token, encKey, publicKey);
    expect(opened).toEqual(payload);
  });

  it("署名鍵が異なると検証失敗しnullを返す(改ざん/偽造検知)", async () => {
    const encKey = await generateQrEncryptionKey();
    const { privateKey } = await generateQrSigningKeyPair();
    const { publicKey: otherPublicKey } = await generateQrSigningKeyPair();
    const token = await buildInternalQrToken({ x: 1 }, encKey, privateKey);
    const opened = await openInternalQrToken(token, encKey, otherPublicKey);
    expect(opened).toBeNull();
  });

  it("暗号文を改ざんすると署名検証は通らずnull(署名は暗号文全体に対して行う)", async () => {
    const encKey = await generateQrEncryptionKey();
    const { privateKey, publicKey } = await generateQrSigningKeyPair();
    const token = await buildInternalQrToken({ x: 1 }, encKey, privateKey);
    const tampered = { ...token, ciphertext_b64: token.ciphertext_b64.slice(0, -2) + "AA" };
    const opened = await openInternalQrToken(tampered, encKey, publicKey);
    expect(opened).toBeNull();
  });
});
