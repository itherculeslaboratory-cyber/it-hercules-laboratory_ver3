#!/usr/bin/env node
// TOOL (not a GATE): derive a collector's SPKI public key from its private key
// (V3-SEC-02 / V3-SEC-03 — the server holds public keys only). A collector keeps
// its private key on-device; this offline tool derives the public half so an
// operator can merge it into COLLECTOR_PUBLIC_KEYS by hand. It NEVER reads or
// rewrites the real .env (secret material is a human gate) — it only reads the
// private PEM path you pass and prints the public key to stdout.
//
// This is a bare Node script (not the Cloudflare Worker bundle), so node:crypto
// is allowed here — the Worker-side code never imports this file.
//
//   node scripts/derive-collector-pubkey.mjs <collector_id> <priv-pem-path>
//     → {"<collector_id>":"<SPKI PEM>"} on stdout
import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Derive the SPKI (PEM) public key from a private key PEM string. */
export function deriveSpki(privatePem) {
  return createPublicKey(privatePem).export({ type: "spki", format: "pem" }).toString();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [id, pemPath] = process.argv.slice(2);
  if (!id || !pemPath) {
    console.error("usage: node scripts/derive-collector-pubkey.mjs <collector_id> <priv-pem-path>");
    process.exit(2);
  }
  const spki = deriveSpki(readFileSync(pemPath, "utf8"));
  // stdout is the merge-into-COLLECTOR_PUBLIC_KEYS payload; done by a human.
  process.stdout.write(JSON.stringify({ [id]: spki }) + "\n");
}
