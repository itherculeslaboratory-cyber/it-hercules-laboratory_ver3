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
};

export type Variables = { actorId: string };
