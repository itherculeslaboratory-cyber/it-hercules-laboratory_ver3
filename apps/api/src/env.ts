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
  // GMO sunabar 照合(design-c4 §2). MODE=sunabar(既定・無料 sandbox)|live(人間
  // ゲートまで throw). TOKEN1/ACCOUNT_ID は READ(入出金明細 poll)用。実値は env のみ。
  GMO_CONNECTOR_MODE?: string;
  GMO_SUNABAR_TOKEN1?: string;
  GMO_SUNABAR_API_BASE?: string;
  GMO_SUNABAR_ACCOUNT_ID?: string;
  // 研究 LLM 助言モード(design-k5 §2.5). 既定 off=静的ヒントのみ. on は実 API キー
  // 必須で人間ゲート「実鍵投入」まで throw. 実値は env のみ(コミット禁止)。
  RESEARCH_LLM_MODE?: string;
};

export type Variables = { actorId: string; roles: string[] };
