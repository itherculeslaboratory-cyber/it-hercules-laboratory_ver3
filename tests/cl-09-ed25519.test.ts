// CL-09: collector Ed25519 署名 (振る舞い TC — schemas/frozen/README.md 担保先).
// Real ver2 fixture (fixtures/cl-09-ed25519-fixture.json, fresh test keypair,
// private key discarded at build). canonical_json port must reproduce the
// signed message byte-for-byte; WebCrypto verify green on the real signature,
// red on a tampered payload.
// Skew note: ver2 verify_collector_signature enforces ±600000ms wall-clock
// skew — full ingest replay must inject now_ms=int(timestamp). C1 tests the
// crypto layer only; the ingest route lands in C2.
import { describe, expect, it } from "vitest";
import { canonicalJson } from "@ihl/truth";
import { loadFixture } from "./helpers";

type Fixture = {
  timestamp: string;
  payload: Record<string, unknown>;
  canonical_json: string;
  signed_message: string;
  signature_base64: string;
  public_key_pem: string;
  tampered: {
    payload: Record<string, unknown>;
    signature_base64: string;
    expected: { ok: boolean; error: string };
  };
};
const fixture = loadFixture<Fixture>("cl-09-ed25519-fixture.json");

const encoder = new TextEncoder();

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
}

async function importPublicKey(pem: string): Promise<CryptoKey> {
  const b64 = pem
    .replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  return crypto.subtle.importKey("spki", b64ToBytes(b64), { name: "Ed25519" }, false, [
    "verify",
  ]);
}

async function verify(message: string, signatureB64: string): Promise<boolean> {
  const key = await importPublicKey(fixture.public_key_pem);
  return crypto.subtle.verify(
    "Ed25519",
    key,
    b64ToBytes(signatureB64),
    encoder.encode(message),
  );
}

describe("CL-09 canonical_json port", () => {
  it("reproduces ver2 canonical_json byte-for-byte (sorted keys, compact)", () => {
    expect(canonicalJson(fixture.payload)).toBe(fixture.canonical_json);
  });

  it("reproduces the signed message '<timestamp_ms>.<canonical_json>'", () => {
    const msg = `${fixture.timestamp}.${canonicalJson(fixture.payload)}`;
    expect(msg).toBe(fixture.signed_message);
  });
});

describe("CL-09 Ed25519 verify (WebCrypto)", () => {
  it("verifies the real fixture signature", async () => {
    const msg = `${fixture.timestamp}.${canonicalJson(fixture.payload)}`;
    expect(await verify(msg, fixture.signature_base64)).toBe(true);
  });

  it("rejects a tampered payload (COLLECTOR_SIGNATURE_INVALID)", async () => {
    const msg = `${fixture.timestamp}.${canonicalJson(fixture.tampered.payload)}`;
    expect(await verify(msg, fixture.tampered.signature_base64)).toBe(false);
    expect(fixture.tampered.expected.error).toBe("COLLECTOR_SIGNATURE_INVALID");
  });

  it("rejects a corrupted signature over the genuine message", async () => {
    const msg = `${fixture.timestamp}.${canonicalJson(fixture.payload)}`;
    const sig = b64ToBytes(fixture.signature_base64);
    sig[0] ^= 0xff;
    const corrupted = btoa(String.fromCharCode(...sig));
    expect(await verify(msg, corrupted)).toBe(false);
  });
});
