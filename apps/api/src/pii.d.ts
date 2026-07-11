// Type declarations for pii.mjs (PII engine・V3-SEC-07 / V3-SEC-13).
export type PiiType =
  | "EMAIL"
  | "PHONE_JP"
  | "CREDIT_CARD"
  | "COORDS"
  | "SNS_ID"
  | "PEM_PRIVATE_KEY"
  | "ENV_SECRET"
  | "ADDRESS_JP";

export type PiiFinding = { type: PiiType; start: number; end: number };

export const PII_PATTERNS: { type: PiiType; re: RegExp }[];
export const STRUCTURED_ID_ALLOW: RegExp[];

export function detectPii(text: string): PiiFinding[];
export function maskPii(text: string): { masked: string; findings: PiiFinding[] };
export function redactForPublic(text: string): { redacted: string; findings: PiiFinding[] };
export function normalizeEmail(email: string): string;
export function deriveEmailIndex(email: string): Promise<string>;
