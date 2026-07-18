// V3-UIX-03 — user-facing error copy. The Renderer must never surface a raw
// transport string like "api 409"; every failure is mapped to a calm Japanese
// sentence. `defaultExecute` throws `ApiError(status)`; node error handlers call
// `mapError(code)` so the alert text is always human, never a status line.

/** Thrown by the renderer's default executor on a non-ok response. Carries the
 *  HTTP status code so the UI can map it to copy without parsing a message. */
export class ApiError extends Error {
  readonly code: string;
  constructor(code: string | number) {
    // The message stays diagnostic (logs/e2e); the UI reads `.code`, not this.
    super(`api ${code}`);
    this.name = "ApiError";
    this.code = String(code);
  }
}

// Status code -> Japanese copy. Covers the codes the API actually returns
// (see apps/api routes: 400/401/403/404/409/429/5xx). Anything else -> fallback.
const MESSAGES: Record<string, string> = {
  "400": "入力内容に誤りがあります。もう一度ご確認ください。",
  "401": "サインインが必要です。もう一度ログインしてください。",
  "403": "この操作を行う権限がありません。",
  "404": "対象が見つかりませんでした。",
  "409": "他の更新と競合しました。最新の状態を確認してからやり直してください。",
  "413": "ファイルが大きすぎます。サイズを小さくしてお試しください。",
  "422": "入力内容を確認してください。",
  "429": "アクセスが集中しています。しばらくしてからお試しください。",
  "500": "サーバでエラーが発生しました。時間をおいて再度お試しください。",
  "502": "サーバに接続できませんでした。時間をおいて再度お試しください。",
  "503": "ただいま混み合っています。しばらくしてからお試しください。",

  // V3-AUT-20: 機械可読な error コード自体を優先して文言変換する(ステータスだけ
  // では潰れる細別を残す)。defaultExecute(renderer.tsx)が可能なら body.error を
  // ApiError.code に積み、無ければ数字ステータスへフォールバックする。
  AUTH_REQUIRED: "サインインが必要です。もう一度ログインしてください。",
  INVALID_TOKEN: "ログインの有効期限が切れました。もう一度お試しください。",
  SESSION_REVOKED: "セッションが無効になりました。もう一度ログインしてください。",
  BANNED: "このアカウントはご利用いただけません。",
  INVALID_EMAIL: "メールアドレスの形式を確認してください。",
  INVALID_CODE: "コードが正しくないか、有効期限が切れています。",
  TOO_MANY_ATTEMPTS: "試行回数の上限に達しました。しばらくしてからお試しください。",
  HANDLE_TAKEN: "この@IDはすでに使われています。別の@IDをお試しください。",
  HANDLE_IMMUTABLE: "@IDは一度決めると変更できません。",

  // 観測登録(バッチ)一括保存の細別
  OBSERVATION_FROZEN: "この観測は現在変更できません。",
  INVALID_CAPTURE: "観測内容に誤りがあります。入力を確認してください。",
  DUPLICATE_CAPTURE: "同じ観測がすでに登録されています。",
  INVALID_ITEM: "この項目は登録できませんでした。入力を確認してください。",
  UNKNOWN_KIND: "この操作には対応していません。",
  NOT_OWNER: "自分が所有していない個体は登録できません。",
};

const FALLBACK = "エラーが発生しました。時間をおいて再度お試しください。";

/** Map an HTTP status code (or ApiError.code) to Japanese copy. Unknown codes
 *  get the generic fallback — a raw "api <n>" is never returned. */
export function mapError(code: string | number): string {
  return MESSAGES[String(code)] ?? FALLBACK;
}
