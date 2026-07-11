// V3-SEC-02 — collector public-key derivation. deriveSpki recovers the exact SPKI
// public key from an ed25519 private key, and a signature made with the private
// key verifies under the derived public key (proving it is the true public half).
import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { deriveSpki } from "../scripts/derive-collector-pubkey.mjs";

describe("V3-SEC-02 deriveSpki(collector pubkey)", () => {
  it("derives the SPKI public key that matches the keypair's own public key", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const expected = publicKey.export({ type: "spki", format: "pem" }).toString();
    const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(deriveSpki(privatePem)).toBe(expected);
  });

  it("derived public key verifies a signature made with the private key", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const msg = Buffer.from("collector-heartbeat");
    const sig = sign(null, msg, privateKey); // ed25519: algorithm is null
    expect(verify(null, msg, deriveSpki(privatePem), sig)).toBe(true);
  });
});
