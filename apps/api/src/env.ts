import type { R2BucketLite } from "@ihl/truth";
import type { KVNamespaceLite } from "./kv";

// Shared Worker binding + context-variable types (index.ts + auth-routes.ts).
export type Bindings = {
  DEV_TOKEN: string;
  TRUTH: R2BucketLite;
  SESSION_SECRET: string;
  // 失効 denylist(V3-AUT-03・round-16 Q-REQ-03 MVP必須格上げ)。userId→失効時刻(epoch秒)。
  // Workers KV Binding が正(本番は未整備 — 実 namespace 作成は人間/インフラ側の一度きり
  // 設備投資として後続波・wrangler.toml に kv_namespaces 未追加)。未バインド時は
  // denylist.ts の revokeActor/isDenylisted が no-op フォールバック(機能degrade・落ちない)。
  AUTH_DENYLIST?: KVNamespaceLite;
  // 数字コード verify(V3-AUT-46・round-16 OQ-ONB-03)の試行回数/消費済み iat 状態。
  // 同上のフォールバック規約(未バインド=試行制限/ワンタイム性が働かない degrade)。
  AUTH_CODE_STATE?: KVNamespaceLite;
  // V3-SEC-14(ログイン系レート制限)+ V3-SEC-58(書込系レート制限+ユーザー別クォータ)の
  // 固定ウィンドウカウンタ用 KV(rate-limit.ts checkRateLimit)。同上のフォールバック規約
  // (未バインド=レート制限が働かない degrade・落ちない)。実 namespace 作成は人間ゲート。
  RATE_LIMIT?: KVNamespaceLite;
  // Optional — mail send is skipped (dev fallback) when RESEND_API_KEY absent.
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  PUBLIC_APP_URL?: string;
  IHL_DEV_EXPOSE_MAGIC_TOKEN?: string;
  // CL-09 collector ingest: JSON map { "<collector_id>": "<Ed25519 SPKI PEM>" }
  // of registered collector public keys. The signature IS the credential
  // (design-c3 §3) — an unregistered collector_id is rejected 401.
  COLLECTOR_PUBLIC_KEYS?: string;
  // GMO sunabar 照合(design-c4 §2)。retired 2026-07-17 round-16(gmo-connector.ts 冒頭
  // 参照)— route 非マウント後は接続層単体 TC 用に型だけ残置。MODE=sunabar(既定・無料
  // sandbox)|live(人間ゲートまで throw). TOKEN1/ACCOUNT_ID は READ(入出金明細 poll)用。
  GMO_CONNECTOR_MODE?: string;
  GMO_SUNABAR_TOKEN1?: string;
  GMO_SUNABAR_API_BASE?: string;
  GMO_SUNABAR_ACCOUNT_ID?: string;
  // PAY.JP 決済コネクタ(payjp-connector.ts / round-16 裁定・L-PAY)。MODE=test(既定・
  // テストモード秘密鍵)|live(人間ゲートまで throw). 実値は env のみ(実鍵投入は人間ゲート)。
  PAYJP_MODE?: string;
  PAYJP_SECRET_KEY?: string;
  PAYJP_API_BASE?: string;
  // 研究 LLM 助言モード(design-k5 §2.5). 既定 off=静的ヒントのみ. on は実 API キー
  // 必須で人間ゲート「実鍵投入」まで throw. 実値は env のみ(コミット禁止)。
  RESEARCH_LLM_MODE?: string;
  // CORS 許可 origin カンマ列(design-k7 FND-11 §1.6). credentials=true のため `*`
  // 不可 — 一致 origin のみ echo する。未設定=全 origin 非許可(ACAO なし)。
  CORS_ALLOW_ORIGINS?: string;
  // AI プロバイダ名(design-k7 FND-21 §1.6). 未設定=AI_DISABLED(既定 OFF・不変条項①)。
  // 実プロバイダの鍵投入は人間ゲート。実値は env のみ。
  IHL_AI_PROVIDER?: string;
};

export type Variables = { actorId: string; roles: string[] };
