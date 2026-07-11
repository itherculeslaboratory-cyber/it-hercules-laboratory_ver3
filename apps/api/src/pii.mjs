// PII エンジン(V3-SEC-07 / V3-SEC-13)— 決定論 regex のみ・LLM 不使用。
// 3 ランタイム(Cloudflare Worker route / vitest / bare-node script)から同一
// ソースを import できるよう .mjs。**node:crypto を import しない**: apps/api/
// wrangler.toml は nodejs_compat 無しのため、SHA-256 は WebCrypto グローバル
// (crypto.subtle)のみ。maskPii/redactForPublic/detectPii は同期 regex、
// deriveEmailIndex だけ async(crypto.subtle.digest)。
//
// ponytail: 電話/住所/カードは naive ヒューリスティック。誤検出時に調整する唯一
// の箇所は各 regex(下の PII_PATTERNS)。span 解決は「開始位置昇順・同一開始は
// 長い方優先」の1ルールで足りる(重なる型が同一開始する入力は稀)。

/**
 * @typedef {"EMAIL"|"PHONE_JP"|"CREDIT_CARD"|"COORDS"|"SNS_ID"|"PEM_PRIVATE_KEY"|"ENV_SECRET"|"ADDRESS_JP"} PiiType
 * @typedef {{ type: PiiType, start: number, end: number }} PiiFinding
 */

/** 決定論 PII パターン(順不同 — span 解決で開始位置により優先付け)。 */
export const PII_PATTERNS = /** @type {{ type: PiiType, re: RegExp }[]} */ ([
  // 秘密鍵ブロックは最優先(内部に他パターンを含みうるので最長で先に食う)。
  { type: "PEM_PRIVATE_KEY", re: /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g },
  { type: "EMAIL", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  // ENV_SECRET: re_… / sk-… / AKIA… / 大文字 KEY=長い値。
  { type: "ENV_SECRET", re: /\bre_[A-Za-z0-9]{16,}\b|\bsk-[A-Za-z0-9]{16,}\b|\bAKIA[0-9A-Z]{16}\b|\b[A-Z][A-Z_]{3,}=\S{12,}/g },
  { type: "CREDIT_CARD", re: /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/g },
  { type: "COORDS", re: /[-+]?\d{1,3}\.\d{3,}\s*,\s*[-+]?\d{1,3}\.\d{3,}/g },
  // ponytail: 住所は 〒NNN-NNNN + 続く非空白ブロックを naive に食う。〒 は必須
  // (省くと電話 NNN-NNNN-NNNN と衝突する)。〒無し住所は本波では非対象=較正ノート。
  { type: "ADDRESS_JP", re: /〒\s*\d{3}-\d{4}\s*[^\s、,]{2,40}/g },
  // ponytail: 日本の固定/携帯を naive に。区切り '-' 前提 + ハイフン無し10-11桁。
  { type: "PHONE_JP", re: /\b0\d{1,4}-\d{1,4}-\d{3,4}\b|\b0\d{9,10}\b/g },
  // SNS_ID: 先頭 @handle。email の @(直前が識別子文字)は lookbehind で除外。
  { type: "SNS_ID", re: /(?<![A-Za-z0-9._%+-])@[A-Za-z0-9_]{2,}/g },
]);

/** 構造化 ID 許可集合(公開時マスク対象外・V3-SEC-13)。TRK 追跡番号 / ULID / trade_event ID(= ULID 形)。 */
export const STRUCTURED_ID_ALLOW = [
  /\bTRK-[A-Z0-9]+\b/g,
  /\b[0-9A-HJKMNP-TV-Z]{26}\b/g, // ULID(Crockford base32)— 観測画像ID・trade_event ID
];

/** 全パターンの生ヒットを集め、重なりを解決した非重複 findings を返す(開始昇順)。 */
function collectSpans(text, patterns) {
  /** @type {PiiFinding[]} */
  const raw = [];
  for (const { type, re } of patterns) {
    for (const m of text.matchAll(re)) {
      if (m.index === undefined || m[0].length === 0) continue;
      raw.push({ type, start: m.index, end: m.index + m[0].length });
    }
  }
  // 開始昇順・同一開始は長い方優先。以後は直前 end を越えた span のみ採用(重なり除去)。
  raw.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  /** @type {PiiFinding[]} */
  const out = [];
  let lastEnd = -1;
  for (const f of raw) {
    if (f.start >= lastEnd) {
      out.push(f);
      lastEnd = f.end;
    }
  }
  return out;
}

/**
 * @param {string} text
 * @returns {PiiFinding[]}
 */
export function detectPii(text) {
  return collectSpans(text, PII_PATTERNS);
}

/**
 * 全 PII を `{{PII:<TYPE>}}` に置換。
 * @param {string} text
 * @returns {{ masked: string, findings: PiiFinding[] }}
 */
export function maskPii(text) {
  const findings = detectPii(text);
  let out = "";
  let cursor = 0;
  for (const f of findings) {
    out += text.slice(cursor, f.start) + `{{PII:${f.type}}}`;
    cursor = f.end;
  }
  out += text.slice(cursor);
  return { masked: out, findings };
}

/** span [start,end) がいずれかの許可 span に内包されるか。 */
function insideAllowed(start, end, allowed) {
  return allowed.some((a) => start >= a.start && end <= a.end);
}

/**
 * 公開用 redact(V3-SEC-13): 構造化ID(TRK/ULID/trade_event)は非マスク、
 * 住所は末尾4文字を残し他は全マスク。
 * @param {string} text
 * @returns {{ redacted: string, findings: PiiFinding[] }}
 */
export function redactForPublic(text) {
  const allowed = [];
  for (const re of STRUCTURED_ID_ALLOW) {
    for (const m of text.matchAll(re)) {
      if (m.index === undefined) continue;
      allowed.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  const findings = detectPii(text).filter((f) => !insideAllowed(f.start, f.end, allowed));
  let out = "";
  let cursor = 0;
  for (const f of findings) {
    const span = text.slice(f.start, f.end);
    const replacement =
      f.type === "ADDRESS_JP" ? `{{PII:ADDRESS_JP}}${span.slice(-4)}` : `{{PII:${f.type}}}`;
    out += text.slice(cursor, f.start) + replacement;
    cursor = f.end;
  }
  out += text.slice(cursor);
  return { redacted: out, findings };
}

/** email 正規化(auth-routes と同一入口規約: trim + lowercase)。 */
export function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

/**
 * email → 安定 index(SHA-256 hex)。呼ぶ瞬間に算出・非保存(不変条項①)。
 * WebCrypto のみ(Worker 安全)。
 * @param {string} email
 * @returns {Promise<string>}
 */
export async function deriveEmailIndex(email) {
  const bytes = new TextEncoder().encode(normalizeEmail(email));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let hex = "";
  for (const b of digest) hex += b.toString(16).padStart(2, "0");
  return hex;
}
