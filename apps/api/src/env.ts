import type { R2BucketLite } from "@ihl/truth";

// Shared Worker binding + context-variable types (index.ts + auth-routes.ts).
export type Bindings = {
  DEV_TOKEN: string;
  TRUTH: R2BucketLite;
  SESSION_SECRET: string;
  // Optional — mail send is skipped (dev fallback) when RESEND_API_KEY absent.
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  PUBLIC_APP_URL?: string;
  IHL_DEV_EXPOSE_MAGIC_TOKEN?: string;
  // CL-09 collector ingest: JSON map { "<collector_id>": "<Ed25519 SPKI PEM>" }
  // of registered collector public keys. The signature IS the credential
  // (design-c3 §3) — an unregistered collector_id is rejected 401.
  COLLECTOR_PUBLIC_KEYS?: string;
};

export type Variables = { actorId: string };
