// V3-SEC-44: 2系統QRコード。公開用(標本・展示向け・暗号化なし・誰でも読み取り可)は
// 既存実装(individual-routes.ts の qr_url = プレーンURL・IND所有・本ファイルは触らない)
// がそのまま満たす。本ファイルが提供するのは観測/管理用(内部限定)の暗号化+署名の
// 生成/検証プリミティブのみ — WebCrypto(crypto.subtle)のみで完結し新規npm依存を
// 追加しない(V3-FND-28凍結リスト遵守)。実際の route 統合(どのIDが内部QRを要求するか
// の判断)は obs/ind 側の担当であり、本ファイルは呼び出し可能な純粋関数を用意するのみ。
//
// AES-256-GCM(暗号化)+ Ed25519(署名)。GCM の nonce(iv)は12byteランダムを毎回生成し
// 呼び出し側が暗号文と一緒に持ち回る(再利用不可・使い捨て)。署名は暗号文全体に対して
// 行う(暗号化後署名=encrypt-then-sign。復号前に改ざん検知できる)。

const IV_BYTES = 12;

export interface EncryptedQrPayload {
  ciphertext_b64: string;
  iv_b64: string;
}

export interface SignedEncryptedQrToken extends EncryptedQrPayload {
  signature_b64: string;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** AES-256-GCM鍵を新規生成(呼び出し側=内部QR発行者がラップ/保管する)。 */
export async function generateQrEncryptionKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

/** Ed25519署名鍵ペアを新規生成(内部QR発行者が保持し、検証側は公開鍵のみ配布)。 */
export async function generateQrSigningKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as Promise<CryptoKeyPair>;
}

/** JSON payload をAES-256-GCMで暗号化する。 */
export async function encryptQrPayload(payload: unknown, key: CryptoKey): Promise<EncryptedQrPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
  return { ciphertext_b64: bytesToB64(ciphertext), iv_b64: bytesToB64(iv) };
}

/** encryptQrPayload の逆。改ざん・鍵不一致は例外(GCMタグ検証失敗)。 */
export async function decryptQrPayload(enc: EncryptedQrPayload, key: CryptoKey): Promise<unknown> {
  const iv = b64ToBytes(enc.iv_b64);
  const ciphertext = b64ToBytes(enc.ciphertext_b64);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

/**
 * 観測/管理用(内部限定)QRトークンを組み立てる: AES-256-GCM暗号化 → 暗号文全体に
 * Ed25519署名。戻り値のJSONがQRコードにエンコードされる想定(呼び出し側の責務)。
 */
export async function buildInternalQrToken(
  payload: unknown,
  encKey: CryptoKey,
  signPrivateKey: CryptoKey,
): Promise<SignedEncryptedQrToken> {
  const enc = await encryptQrPayload(payload, encKey);
  const signed = new TextEncoder().encode(enc.ciphertext_b64 + ":" + enc.iv_b64);
  const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", signPrivateKey, signed));
  return { ...enc, signature_b64: bytesToB64(signature) };
}

/**
 * buildInternalQrToken の逆。署名検証 → 復号。署名不一致は null を返す(例外にしない
 * = 呼び出し側が「無効QR」として一律扱えるようにする)。改ざん済み暗号文は
 * decryptQrPayload 側のGCMタグ検証で例外になる(呼び出し側でcatchする)。
 */
export async function openInternalQrToken(
  token: SignedEncryptedQrToken,
  encKey: CryptoKey,
  signPublicKey: CryptoKey,
): Promise<unknown | null> {
  const signed = new TextEncoder().encode(token.ciphertext_b64 + ":" + token.iv_b64);
  const signature = b64ToBytes(token.signature_b64);
  const valid = await crypto.subtle.verify("Ed25519", signPublicKey, signature, signed);
  if (!valid) return null;
  return decryptQrPayload(token, encKey);
}
