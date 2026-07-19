// 「取引中」画面の当事者スコープ・ビューモデル(V3-MKT round-16裁定②=取引中は独立画面)。
// market-settlement.ts の状態機械/投影の生の値から、画面が必要とする派生表示
// (誰の番か・今どの段階か・急ぎ色フラグ)を組み立てる純関数群。常駐DB無し・都度再計算
// (不変条項①)。GET /market/transactions/mine が呼ぶだけで、実データ配線はこの1本の
// ビューモデルに集約する(finder-data.js ↔ individual-finder-utils.ts と同型の
// 「派生ロジックは型付き1箇所+テスト」パターン。ただし取引中はサーバ側1箇所に集約し、
// public/torihikichu.js は描画のみで派生ロジックを持たない)。
import type { MarketState, PaymentStatus } from "./market-settlement";
import { GRACE_CANCEL_MINUTES, NO_PAY_CANCEL_HOURS, AUTO_GOOD_RATING_DAYS } from "./economy-constants";

export type DealRole = "buy" | "sell";
export type Turn = "you" | "them";

/** 取引中とみなす state(成立〜評価前。sold=完了/cancelled/delisted は一覧から外す)。 */
export const IN_PROGRESS_STATES = new Set(["matched", "shipped", "received", "rated"]);

export interface TxnFlag {
  level: "hot" | "warn";
  text: string;
}
export interface StepStatus {
  name: string;
  status: "done" | "now" | "future";
}

const STEP_NAMES = ["成立", "お支払い", "発送", "受け取り", "評価・完了"];
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** 観測者から見た役割。売り手(出品者)か買い手(matched_with)か。当事者でなければ null。 */
export function roleOf(state: MarketState, viewerId: string): DealRole | null {
  if (state.seller_id === viewerId) return "sell";
  if (state.matched_with === viewerId) return "buy";
  return null;
}

/** 状態ラベル(観測者非依存の客観的な段階名)。state-pill に出す。 */
export function stateLabel(state: string, payment: PaymentStatus): string {
  switch (state) {
    case "matched":
      if (!payment.declared_at) return "成立・お支払い前";
      if (!payment.confirmed_at) return "入金確認中";
      return "発送準備中";
    case "shipped":
      return "発送済み・受け取り待ち";
    case "received":
      return "受け取り済み・評価待ち";
    case "rated":
      return "評価済み・受け取り確認待ち";
    default:
      return state;
  }
}

/** 「あなたの番」か「相手待ち」か + 一言アクション。役割で分岐する。 */
export function turnOf(state: string, role: DealRole, payment: PaymentStatus): { turn: Turn; action: string } {
  const you = (action: string): { turn: Turn; action: string } => ({ turn: "you", action });
  const them = (action: string): { turn: Turn; action: string } => ({ turn: "them", action });
  switch (state) {
    case "matched":
      if (!payment.declared_at) {
        // お支払いは買い手の番
        return role === "buy" ? you("お支払い") : them("入金を待っています");
      }
      if (!payment.confirmed_at) {
        // 入金確認は売り手の番
        return role === "sell" ? you("入金を確認") : them("入金の確認待ち");
      }
      // 入金確認済み → 発送は売り手の番
      return role === "sell" ? you("発送する") : them("発送を待っています");
    case "shipped":
      // 受け取りは買い手の番
      return role === "buy" ? you("受け取り確認") : them("受け取り連絡待ち");
    case "received":
      // 受取済み・評価が残る → 評価は買い手の番
      return role === "buy" ? you("評価する") : them("評価待ち");
    case "rated":
      // 評価済み・受取確認が残る → 買い手の番
      return role === "buy" ? you("受け取り確認") : them("受け取り連絡待ち");
    default:
      return them("—");
  }
}

/** 「あなたの番」のときに押せる遷移 kind(POST /market/listings/{id}/transition)。
 * 相手待ち(turn=them)なら null。turnOf と同じ分岐を1箇所に持つ。 */
export function actionKindOf(state: string, role: DealRole, payment: PaymentStatus): string | null {
  if (turnOf(state, role, payment).turn !== "you") return null;
  switch (state) {
    case "matched":
      if (!payment.declared_at) return "pay_declare"; // 買い手:振込申告
      if (!payment.confirmed_at) return "pay_confirm"; // 売り手:入金確認
      return "ship"; // 売り手:発送
    case "shipped":
      return "receive"; // 買い手:受け取り
    case "received":
      return "rate"; // 買い手:評価
    case "rated":
      return "receive"; // 買い手:受け取り確認
    default:
      return null;
  }
}

/** ステッパーの現在段。成立(0)は取引中なら常に done。 */
export function stepper(state: string, payment: PaymentStatus): StepStatus[] {
  let now: number;
  if (state === "matched") now = payment.confirmed_at ? 2 : 1; // 入金確認まで=お支払い段階
  else if (state === "shipped") now = 3; // 受け取り待ち
  else if (state === "rated") now = 3; // 評価済み・受け取り確認が残る(MARKET_EDGES.rated={receive:sold})
  else now = 4; // received: 受取済み・評価が残る
  return STEP_NAMES.map((name, i) => ({
    name,
    status: i < now ? "done" : i === now ? "now" : "future",
  }));
}

function fmtRemaining(ms: number): string {
  if (ms <= 0) return "まもなく";
  if (ms >= DAY_MS) return `あと${Math.floor(ms / DAY_MS)}日`;
  if (ms >= HOUR_MS) return `あと${Math.floor(ms / HOUR_MS)}時間`;
  return `あと${Math.max(1, Math.floor(ms / MINUTE_MS))}分`;
}

/** 急ぎフラグ(実タイムスタンプ+経済定数から算出。捏造しない)。
 * - 買い手×matched: 無料キャンセル残り(GRACE_CANCEL_MINUTES) = hot
 * - 売り手×matched×未入金確認: 48h未入金で自動キャンセル(NO_PAY_CANCEL_HOURS) = warn
 * - shipped×未評価: 発送30日で自動「良い」評価(AUTO_GOOD_RATING_DAYS) = warn */
export function flagsOf(input: {
  state: string;
  role: DealRole;
  payment: PaymentStatus;
  matchedAt?: string;
  shippedAt?: string;
  now: Date;
}): TxnFlag[] {
  const { state, role, payment, matchedAt, shippedAt, now } = input;
  const flags: TxnFlag[] = [];
  const t = now.getTime();

  if (state === "matched" && matchedAt) {
    const graceLeft = new Date(matchedAt).getTime() + GRACE_CANCEL_MINUTES * MINUTE_MS - t;
    if (role === "buy" && graceLeft > 0) {
      flags.push({ level: "hot", text: `⏳ 無料キャンセル${fmtRemaining(graceLeft)}` });
    }
    if (role === "sell" && !payment.confirmed_at) {
      const noPayLeft = new Date(matchedAt).getTime() + NO_PAY_CANCEL_HOURS * HOUR_MS - t;
      flags.push(
        noPayLeft > 0
          ? { level: "warn", text: `⏳ 未入金${NO_PAY_CANCEL_HOURS}hで自動キャンセル(${fmtRemaining(noPayLeft)})` }
          : { level: "hot", text: "⏳ 未入金により自動キャンセル対象" },
      );
    }
  }

  if (state === "shipped" && shippedAt) {
    // 発送後の自動「良い」評価は評価未了時のみ。shipped state = まだ rate されていない
    // (rate されると rated/sold へ遷移し取引中一覧から外れる)。
    const autoGoodLeft = new Date(shippedAt).getTime() + AUTO_GOOD_RATING_DAYS * DAY_MS - t;
    flags.push({ level: "warn", text: `🕊 発送${AUTO_GOOD_RATING_DAYS}日で自動「良い」評価(${fmtRemaining(autoGoodLeft)})` });
  }

  return flags;
}
