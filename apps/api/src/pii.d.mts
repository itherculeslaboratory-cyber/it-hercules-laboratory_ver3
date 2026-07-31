// pii.mjs の型宣言(手書き)。pii.mjs が実際に export しているものだけを書く
// (2026-07-31 tsc6 T5)。pii.mjs 側が JSDoc で型付けされた .mjs であり自動生成
// できる .d.ts が無いため、export の変更時はこのファイルも手で追従させること。

export type PiiType =
  | "EMAIL"
  | "PHONE_JP"
  | "CREDIT_CARD"
  | "COORDS"
  | "SNS_ID"
  | "PEM_PRIVATE_KEY"
  | "ENV_SECRET"
  | "ADDRESS_JP";

export interface PiiFinding {
  type: PiiType;
  start: number;
  end: number;
}

export const PII_PATTERNS: { type: PiiType; re: RegExp }[];
export const STRUCTURED_ID_ALLOW: RegExp[];

export function detectPii(text: string): PiiFinding[];
export function maskPii(text: string): { masked: string; findings: PiiFinding[] };
export function redactForPublic(text: string): { redacted: string; findings: PiiFinding[] };
export function normalizeEmail(email: string): string;
export function derivePublicUserId(userId: string, secretSalt: string): Promise<string>;
export function deriveEmailIndex(email: string): Promise<string>;
