// Config-driven integer policy resolver (V3-KRM-16 economy-policy /
// V3-MKT-39 tradePolicyResolver). The CSV config is an append-only history:
// GUI edits (後波) append a new row with a newer timestamp; the resolver reads
// the latest row per key and never mutates history. Pure functions only —
// callers pass rows they already parsed (workerd cannot readFileSync at
// runtime; bundle the CSV text via esbuild text import, then parsePolicyCsv it).
//
// ponytail: CSV, not a DB — policy tables are tiny and read at request time by
// full scan. Add an index only if a table grows past thousands of rows.

export type PolicyRow = {
  policy_key: string;
  policy_int: number;
  domain?: string;
  timestamp: string;
};

/**
 * Parse a policy CSV (header row names the columns; column order is not
 * assumed). Requires policy_key, policy_int, timestamp; domain is optional.
 * Blank lines are skipped. policy_int must be an integer.
 */
export function parsePolicyCsv(text: string): PolicyRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const kI = idx("policy_key");
  const vI = idx("policy_int");
  const tI = idx("timestamp");
  const dI = idx("domain");
  if (kI < 0 || vI < 0 || tI < 0) {
    throw new Error("policy CSV missing required column (policy_key/policy_int/timestamp)");
  }
  const rows: PolicyRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const policy_int = Number(cols[vI]);
    if (!Number.isInteger(policy_int)) {
      throw new Error(`policy CSV row ${i}: policy_int not an integer: ${cols[vI]}`);
    }
    rows.push({
      policy_key: cols[kI],
      policy_int,
      timestamp: cols[tI],
      ...(dI >= 0 && cols[dI] ? { domain: cols[dI] } : {}),
    });
  }
  return rows;
}

/**
 * Resolve the current integer value for policy_key: the policy_int of the row
 * with the latest timestamp (append-only history — older rows are retained but
 * superseded). Throws if the key is absent and no fallback is given.
 */
export function resolvePolicyInt(
  policyKey: string,
  rows: PolicyRow[],
  fallback?: number,
): number {
  let best: PolicyRow | undefined;
  for (const row of rows) {
    if (row.policy_key !== policyKey) continue;
    if (!best || Date.parse(row.timestamp) > Date.parse(best.timestamp)) best = row;
  }
  if (best) return best.policy_int;
  if (fallback !== undefined) return fallback;
  throw new Error(`policy key not found: ${policyKey}`);
}

// ── V3-SEC-15 open-redirect ガード ──────────────────────────────────────
// 認証済み /login?next= の遷移先は「内部絶対パス(/始まり・//不可)」のみ許可する。
// それ以外(外部URL・プロトコル相対 //evil.com・空値)は "/" にフォールバックする。
// 呼び出し側(auth-routes.ts の /login?next= 相当処理・w1-aut所有)は本関数の戻り値を
// そのまま redirect 先として使えばよい(判定ロジックをここに一本化・重複実装させない)。
export function safeNextPath(next: string | null | undefined): string {
  if (typeof next !== "string" || next.length === 0) return "/";
  if (!next.startsWith("/")) return "/"; // 外部URL(http://...)・相対パスを拒否
  if (next.startsWith("//")) return "/"; // プロトコル相対(スキームレス外部URL)を拒否
  return next;
}

// ── V3-SEC-19 本番認証バイパス変数の不在チェック ───────────────────────────
// 要件本文が名指しする IHL_AUTH_REQUIRED/IHL_AUTH_BYPASS/IHL_WEB_AUTH_BYPASS は、
// 現行の index.ts 認可ゲート(deny-by-default・PUBLIC_ROUTES 明示リスト方式)には
// 実装として存在しない(該当変数名の参照はコード中ゼロ件・2026-07-31実測)。この関数は
// 将来これらの変数名が実装に持ち込まれた場合に備えた回帰チェック(CI/ops が呼べる)。
export interface ProdAuthEnvCheck {
  ok: boolean;
  problems: string[];
}
export function checkProdAuthEnv(env: Record<string, string | undefined>): ProdAuthEnvCheck {
  const problems: string[] = [];
  if (env.IHL_AUTH_REQUIRED !== undefined && env.IHL_AUTH_REQUIRED !== "1") {
    problems.push("IHL_AUTH_REQUIRED must be '1' (or left unset in code that has no bypass path)");
  }
  if (env.IHL_AUTH_BYPASS) problems.push("IHL_AUTH_BYPASS must be unset in production");
  if (env.IHL_WEB_AUTH_BYPASS) problems.push("IHL_WEB_AUTH_BYPASS must be unset (would bypass all routes)");
  return { ok: problems.length === 0, problems };
}

// ── V3-SEC-10 サンドボックス用ユーザーID連番再割当 ──────────────────────────
// 外部開発者向け完全クローン環境で本番 actorId を隠すため、登場順に 1,2,3... の
// 連番へ再割当する。変換表(戻り値の Map)は呼び出し側がローカル暗号化ストレージに
// のみ保持し、TRUTH(R2・公開/共有ストレージ)には一切保存しない — この関数自体が
// TruthStore/R2 を一切 import/参照しないことが、その構造的な保証(下記
// sec-w2-batch.test.ts の負の回帰テストが固定)。
export function assignSandboxIds(actorIds: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  let next = 1;
  for (const id of actorIds) {
    if (!map.has(id)) map.set(id, next++);
  }
  return map;
}

// ── V3-SEC-21/22/23 利用規約バージョン管理・動画resolver・scroll gate ──────────
// 実際の法的文書本文(docs/legal/等)は本艦の書いてよい場所(apps/api/src・tests)の
// 外にあるため作成しない(発注書「書いてよい場所」節・スコープ境界を厳守)。ここでは
// 「版管理・動画URL間接参照・スクロール完了判定」という版に依存しないロジックだけを
// 提供する(実際の条文/動画URL登録は法務ドラフト整備=SEC-25と合わせて別途)。
export interface TermsVersionInfo {
  terms_version: string;
  effective_at: string;
}

/** 法的版のみが契約上の効力を持つ(V3-SEC-21)。やさしい版・動画は説明用の別表現。 */
export const TERMS_KIND_LEGAL = "legal" as const;
export const TERMS_KIND_EASY = "easy" as const;
export const TERMS_KIND_VIDEO = "video" as const;
export type TermsKind = typeof TERMS_KIND_LEGAL | typeof TERMS_KIND_EASY | typeof TERMS_KIND_VIDEO;

export interface TermsMediaRow {
  terms_version: string;
  section_id: string;
  media_kind: TermsKind;
  resolved_url: string;
}

/**
 * terms_version + section_id + media_kind → resolved_url の間接参照(V3-SEC-22)。
 * 版が変わってもマッピング行を追加するだけでよく、規約本文に動画URLを直書きしない。
 */
export function resolveTermsMediaUrl(
  rows: readonly TermsMediaRow[],
  termsVersion: string,
  sectionId: string,
  mediaKind: TermsKind,
): string | null {
  const row = rows.find(
    (r) => r.terms_version === termsVersion && r.section_id === sectionId && r.media_kind === mediaKind,
  );
  return row ? row.resolved_url : null;
}

/**
 * scroll gate(V3-SEC-23): 全文スクロール完了までは同意チェックを不可にする。
 * 1px の丸め誤差を許容(下端到達判定の一般的な許容差)。
 */
export function isScrollComplete(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
  return scrollTop + clientHeight >= scrollHeight - 1;
}

// ── V3-SEC-29 収集項目の透明性・ログ用途限定 ────────────────────────────────
// 利用規約に明記すべき収集項目一覧(実際の条文掲載はSEC-25の法務ドラフト整備側)。
export const DATA_COLLECTION_ITEMS = [
  "email",
  "country",
  "language",
  "screen_transition_log",
  "post_history",
  "ai_usage_log",
] as const;

/** 行動ログの利用目的はサービス改善・不正防止のみに限定し、広告目的を含まない。 */
export const LOG_PURPOSE_ALLOWED = ["service_improvement", "fraud_prevention"] as const;
export type LogPurpose = (typeof LOG_PURPOSE_ALLOWED)[number];

export function isLogPurposeAllowed(purpose: string): purpose is LogPurpose {
  return (LOG_PURPOSE_ALLOWED as readonly string[]).includes(purpose);
}

// ── V3-SEC-35 外部AIモデル再学習に使わない宣言 ───────────────────────────────
// 実装の裏付け: ai-kernel.ts は IHL_AI_PROVIDER 未設定時デフォルトで全タスクを
// AiDisabledError(501 AI_DISABLED)にする(ai-kernel.ts:20-33)— 外部AIへの
// データ送信経路自体が既定でゼロであり、再学習用途に使われる余地が構造的に無い。
export const AI_TRAINING_POLICY = "no-retrain" as const;

// ── V3-SEC-37 OSS/テンプレートのライセンス管理 ──────────────────────────────
export type OssLicenseKind = "CC-BY" | "no-redistribute" | "GPL" | "other";
export type OssLicenseAction = "auto_credit_lock" | "public_forbidden" | "reject_import" | "manual_review";

export interface OssLicenseRule {
  license: OssLicenseKind;
  action: OssLicenseAction;
  why: string;
}

export const OSS_LICENSE_RULES: readonly OssLicenseRule[] = [
  { license: "CC-BY", action: "auto_credit_lock", why: "クレジット自動挿入・ロック" },
  { license: "no-redistribute", action: "public_forbidden", why: "再配布NGは公開不可" },
  { license: "GPL", action: "reject_import", why: "GPLは取り込み拒否" },
  { license: "other", action: "manual_review", why: "未分類ライセンスは人手確認" },
];

export function resolveOssLicenseAction(license: OssLicenseKind): OssLicenseAction {
  const rule = OSS_LICENSE_RULES.find((r) => r.license === license);
  return rule ? rule.action : "manual_review";
}

// ── V3-SEC-39 コンテンツ本文のXSS対策(Markdown→sanitize済みHTML) ────────────
// ponytail: 新規npm依存(DOMPurify等)を追加せずホワイトリスト方式の最小サニタイザを
// 自前実装する(V3-FND-28凍結リストの「新規ライブラリ差し戻し」誘惑を避ける)。
// 生HTML注入を一切許さない(入力中の `<`/`>`/`&` は常にエンティティ化してからMarkdown
// 記法だけを許可タグへ変換 = raw HTML パススルー経路が構造的に存在しない)。
const MD_ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => MD_ESCAPE[ch]);
}

/**
 * 最小 Markdown → sanitize済みHTML。対応記法: **bold**, *italic*, `code`,
 * [text](url)(http/httpsのみ許可)、改行→<br>。それ以外は全てエスケープ済み
 * テキストとして出力される(raw HTML の注入不可)。
 */
export function sanitizeMarkdownToHtml(markdown: string): string {
  let out = escapeHtml(markdown);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, text, url) => `<a href="${url}" rel="noopener noreferrer">${text}</a>`);
  out = out.replace(/\n/g, "<br>");
  return out;
}

// ── V3-SEC-43 投稿画像の知覚ハッシュ(盗用・すり替え検知) ────────────────────
// difference hash (dHash): 隣接ピクセルの明度勾配をビット列化する古典的知覚ハッシュ。
// 画像デコード自体(JPEG/PNG展開)は新規npm依存を要するため対象外とし、既に
// グレースケール輝度配列へ展開済みのピクセルデータを受け取る形にする(呼び出し側=
// 画像アップロード経路の所有ドメイン(obs/mkt)が既存のサムネイル生成等でピクセル配列を
// 用意する)。「ひっそり警告してeventに記録」の判定閾値はハミング距離で表現する。
export function dHash(pixels: readonly number[], width: number, height: number): bigint {
  if (pixels.length !== width * height) {
    throw new Error(`dHash: pixels.length (${pixels.length}) must equal width*height (${width * height})`);
  }
  let bits = 0n;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      bits <<= 1n;
      if (pixels[y * width + x] < pixels[y * width + x + 1]) bits |= 1n;
    }
  }
  return bits;
}

/** 2つの知覚ハッシュ間のハミング距離(ビット差の数)。小さいほど類似=盗用疑い。 */
export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/** 既定の盗用疑い閾値(較正knob)。距離がこれ以下なら「ひっそり警告」対象。 */
export const IMAGE_REUSE_SUSPECT_THRESHOLD = 10;

// ── V3-SEC-43 追加: 成長曲線・EXIF・特徴点の整合性検知+ひっそり警告のevent記録 ──
// (2026-07-31 w3-sec 是正: 62代目HQ検収是正 R0731-14f1df 中1「dHashのみでは要件の
// 中核=成長曲線/EXIF/特徴点整合性/event記録が未実装」を受けて追加。dHash同様、画像
// デコードそのもの(EXIF抽出・特徴点検出)は対象外とし、既にobs/mkt側が抽出済みの
// 構造化データを受け取って矛盾検知する純関数のみ提供する。)
export interface ExifSnapshot {
  captured_at: string; // ISO8601
  device_model?: string;
}

/** 同一個体の継続撮影として時系列・撮影デバイス系列が矛盾しないか(すり替え疑い検知の1本目)。 */
export function checkExifConsistency(prior: ExifSnapshot, next: ExifSnapshot): boolean {
  if (Date.parse(next.captured_at) < Date.parse(prior.captured_at)) return false; // 時系列逆行
  if (prior.device_model && next.device_model && prior.device_model !== next.device_model) return false;
  return true;
}

export interface GrowthCurvePoint {
  observed_at: string;
  size_cm: number;
}

/** 成長曲線は単調非減少が前提(許容誤差込み)。急激な縮小は別個体すり替え疑い(2本目)。 */
export function checkGrowthCurveConsistency(
  points: readonly GrowthCurvePoint[],
  shrinkToleranceCm = 0.5,
): boolean {
  const sorted = [...points].sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].size_cm < sorted[i - 1].size_cm - shrinkToleranceCm) return false;
  }
  return true;
}

/** 特徴点(斑紋・体表パターン等)の一致率判定。特徴点抽出自体は呼び出し側の責務(3本目)。 */
export function checkFeaturePointConsistency(
  a: readonly (readonly [number, number])[],
  b: readonly (readonly [number, number])[],
  matchToleranceCm: number,
  minMatchRatio = 0.6,
): boolean {
  if (a.length === 0 || b.length === 0) return false;
  let matched = 0;
  for (const [ax, ay] of a) {
    if (b.some(([bx, by]) => Math.hypot(ax - bx, ay - by) <= matchToleranceCm)) matched++;
  }
  return matched / a.length >= minMatchRatio;
}

export type ImageReuseFlagReason =
  | "dhash_similar"
  | "exif_inconsistent"
  | "growth_curve_inconsistent"
  | "feature_point_mismatch";

export interface ImageReuseSilentWarning {
  event_type: "image_reuse_suspect";
  reasons: readonly ImageReuseFlagReason[];
  flagged_at: string;
}

/**
 * 「公開処刑せず、ひっそり警告してeventに記録する」の記録形を一本化する(4本目)。
 * 呼び出し側(obs/mkt)はこの戻り値をそのまま Truth へ putEvent すればよい。
 */
export function buildImageReuseSilentWarning(
  reasons: readonly ImageReuseFlagReason[],
  flaggedAt: string,
): ImageReuseSilentWarning {
  return { event_type: "image_reuse_suspect", reasons, flagged_at: flaggedAt };
}

// ── V3-SEC-47 追加: DM個別取引禁止判定・IP/デバイス指紋 ────────────────────────
// (2026-07-31 w3-sec 是正: 62代目HQ検収是正 R0731-14f1df 重大2「DM取引禁止・
// デバイス指紋がgrep0件」を受けて追加。DM本文の検知経路自体・指紋の呼び出し配線は
// plaza/ind側の担当globのため、判定ロジックのみをここに一本化する。)
const DM_TRADE_TRIGGER_PATTERN =
  /(coin|karma|価値|コイン|カルマ).{0,15}(送|渡|あげ|払|trade|transfer)|(送|渡|あげ|払|trade|transfer).{0,15}(coin|karma|価値|コイン|カルマ)/i;

/** 取引はプラットフォーム内限定。DM本文にvalue/coin授受のトリガー文言があれば拒否。 */
export function isDmTradeAllowed(messageText: string): boolean {
  return !DM_TRADE_TRIGGER_PATTERN.test(messageText);
}

/** IP/デバイス指紋 = SHA-256(clientIp + userAgent)。derivePublicUserId(pii.mjs)と同一のWebCrypto-only規約。 */
export async function deriveDeviceFingerprint(clientIp: string, userAgent: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${clientIp}:${userAgent}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let hex = "";
  for (const b of digest) hex += b.toString(16).padStart(2, "0");
  return hex;
}

// ── V3-SEC-50 保護アセット(ブランド資産)NG設定 ───────────────────────────
export type ProtectedAssetKind = "brand" | "general" | "observation";
export type AssetUseKind = "video_generation" | "ui_generation" | "rag_search" | "ai_training";

export interface ProtectedAssetEntry {
  asset_id: string;
  kind: ProtectedAssetKind;
  blocked_uses: readonly AssetUseKind[];
  ai_training_allowed: boolean;
}

/**
 * アセット種別はユーザーが明示指定し自動判定しない(誤BAN防止)。observation
 * (観測データ=文明資産)は保護対象に登録されていても常に観測・採用候補として
 * 扱う=blocked_uses に含めても RAG検索/採用候補化はブロックしない、という
 * 呼び出し側の運用規約をここに固定する。
 */
export function isAssetAllowedForUse(entry: ProtectedAssetEntry, use: AssetUseKind): boolean {
  if (entry.kind === "observation") return true; // 観測データは保護対象に入れられない
  if (use === "ai_training") return entry.ai_training_allowed;
  return !entry.blocked_uses.includes(use);
}
