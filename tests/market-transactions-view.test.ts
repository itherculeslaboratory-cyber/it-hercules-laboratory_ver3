// 「取引中」独立画面(round-16裁定②)のビューモデル + GET /market/transactions/mine。
// 純関数(誰の番か/段階/急ぎ色)の境界と、当事者スコープ(観測者が売り手/買い手の
// in-progress 取引だけを返す)を実機で検証する。実データ配線はこのビューモデル1本に集約。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import {
  roleOf,
  stateLabel,
  turnOf,
  actionKindOf,
  stepper,
  flagsOf,
} from "../apps/api/src/market-transactions-view";
import type { MarketState, PaymentStatus } from "../apps/api/src/market-settlement";
import { NO_PAY_CANCEL_HOURS, GRACE_CANCEL_MINUTES, AUTO_GOOD_RATING_DAYS } from "../apps/api/src/economy-constants";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

const pay = (o: Partial<PaymentStatus> = {}): PaymentStatus => ({ method: "bank_transfer", ...o });
const bearer = (tok: string) => ({ Authorization: `Bearer ${tok}`, "content-type": "application/json" });
function transition(env: object, headers: Record<string, string>, id: string, body: unknown) {
  return app.request(`/api/v1/market/listings/${id}/transition`, { method: "POST", headers, body: JSON.stringify(body) }, env);
}
function mine(env: object, headers: Record<string, string>) {
  return app.request("/api/v1/market/transactions/mine", { headers }, env);
}

// ── 純関数 ────────────────────────────────────────────────────────────────
describe("roleOf: 観測者の当事者役割", () => {
  const st = { listing_id: "L", state: "matched", seller_id: "S", matched_with: "B", bids: [], stage: 2 } as MarketState;
  it("売り手/買い手/第三者を判別", () => {
    expect(roleOf(st, "S")).toBe("sell");
    expect(roleOf(st, "B")).toBe("buy");
    expect(roleOf(st, "X")).toBeNull();
  });
});

describe("turnOf: 誰の番か(役割×段階×決済)", () => {
  it("matched・未申告=お支払いは買い手の番", () => {
    expect(turnOf("matched", "buy", pay())).toEqual({ turn: "you", action: "お支払い" });
    expect(turnOf("matched", "sell", pay())).toEqual({ turn: "them", action: "入金を待っています" });
  });
  it("申告後・未確認=入金確認は売り手の番", () => {
    const p = pay({ declared_at: "2026-01-01T00:00:00Z" });
    expect(turnOf("matched", "sell", p).turn).toBe("you");
    expect(turnOf("matched", "buy", p).turn).toBe("them");
  });
  it("入金確認後=発送は売り手の番", () => {
    const p = pay({ declared_at: "x", confirmed_at: "y" });
    expect(turnOf("matched", "sell", p).action).toBe("発送する");
  });
  it("shipped=受け取りは買い手の番", () => {
    expect(turnOf("shipped", "buy", pay()).turn).toBe("you");
    expect(turnOf("shipped", "sell", pay()).turn).toBe("them");
  });
});

describe("actionKindOf: あなたの番で押せる遷移", () => {
  it("買い手の番は遷移kind、相手待ちは null", () => {
    expect(actionKindOf("matched", "buy", pay())).toBe("pay_declare");
    expect(actionKindOf("matched", "sell", pay())).toBeNull(); // 売り手は入金待ち=押せない
    expect(actionKindOf("matched", "sell", pay({ declared_at: "x" }))).toBe("pay_confirm");
    expect(actionKindOf("matched", "sell", pay({ declared_at: "x", confirmed_at: "y" }))).toBe("ship");
    expect(actionKindOf("shipped", "buy", pay())).toBe("receive");
    expect(actionKindOf("received", "buy", pay())).toBe("rate");
  });
});

describe("stateLabel / stepper", () => {
  it("stateLabel は決済段階で変わる", () => {
    expect(stateLabel("matched", pay())).toBe("成立・お支払い前");
    expect(stateLabel("matched", pay({ declared_at: "x" }))).toBe("入金確認中");
    expect(stateLabel("shipped", pay())).toBe("発送済み・受け取り待ち");
  });
  it("stepper の現在段は state/決済を追う。成立は取引中なら常に done", () => {
    expect(stepper("matched", pay()).findIndex((s) => s.status === "now")).toBe(1);
    expect(stepper("matched", pay({ declared_at: "x", confirmed_at: "y" })).findIndex((s) => s.status === "now")).toBe(2);
    expect(stepper("shipped", pay()).findIndex((s) => s.status === "now")).toBe(3);
    expect(stepper("received", pay()).findIndex((s) => s.status === "now")).toBe(4); // 受取済み・評価が残る
    expect(stepper("rated", pay()).findIndex((s) => s.status === "now")).toBe(3); // 評価済み・受取確認が残る
    expect(stepper("received", pay())[0].status).toBe("done");
  });
});

describe("flagsOf: 急ぎ色は実タイムスタンプ+経済定数から算出", () => {
  const matchedAt = "2026-01-01T00:00:00Z";
  it("買い手×matched=無料キャンセル残り(hot)", () => {
    const now = new Date(new Date(matchedAt).getTime() + (GRACE_CANCEL_MINUTES - 30) * 60_000);
    const f = flagsOf({ state: "matched", role: "buy", payment: pay(), matchedAt, now });
    expect(f.some((x) => x.level === "hot" && x.text.includes("無料キャンセル"))).toBe(true);
  });
  it("売り手×matched×未確認=48h自動キャンセル予告", () => {
    const now = new Date(new Date(matchedAt).getTime() + 60_000);
    const f = flagsOf({ state: "matched", role: "sell", payment: pay(), matchedAt, now });
    expect(f.some((x) => x.text.includes(`${NO_PAY_CANCEL_HOURS}h`))).toBe(true);
  });
  it("入金確認済みなら no-pay フラグは消える", () => {
    const now = new Date(new Date(matchedAt).getTime() + 60_000);
    const f = flagsOf({ state: "matched", role: "sell", payment: pay({ confirmed_at: "x" }), matchedAt, now });
    expect(f.length).toBe(0);
  });
  it("shipped=発送30日で自動良い評価の予告", () => {
    const shippedAt = "2026-01-01T00:00:00Z";
    const now = new Date(new Date(shippedAt).getTime() + 5 * 24 * 3600_000);
    const f = flagsOf({ state: "shipped", role: "buy", payment: pay(), shippedAt, now });
    expect(f.some((x) => x.text.includes(`${AUTO_GOOD_RATING_DAYS}日`))).toBe(true);
  });
});

// ── route: 当事者スコープ(実機) ──────────────────────────────────────────
describe("GET /market/transactions/mine", () => {
  it("未認証は 401(deny-by-default)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const res = await mine(env, { "content-type": "application/json" });
    expect(res.status).toBe(401);
  });

  it("成立中の取引を当事者の役割/番付きで返し、第三者には出さない", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("seller1", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("buyer1", SESSION_SECRET));
    const strangerH = bearer(await issueSessionToken("stranger1", SESSION_SECRET));
    await transition(env, sellerH, "TX1", { kind: "list_fixed", amount: 12000 });
    await transition(env, buyerH, "TX1", { kind: "match" }); // 即決成立=matched

    const buyerView = (await (await mine(env, buyerH)).json()) as { transactions: Array<Record<string, unknown>> };
    expect(buyerView.transactions).toHaveLength(1);
    const t = buyerView.transactions[0];
    expect(t.listing_id).toBe("TX1");
    expect(t.role).toBe("buy");
    expect(t.state).toBe("matched");
    expect(t.turn).toBe("you"); // お支払いは買い手の番
    expect(t.turn_action).toBe("お支払い");
    expect(typeof t.transfer_code).toBe("string");
    expect((t.transfer_code as string).startsWith("U-")).toBe(true); // CL-11 形式

    const sellerView = (await (await mine(env, sellerH)).json()) as { transactions: Array<Record<string, unknown>> };
    expect(sellerView.transactions).toHaveLength(1);
    expect(sellerView.transactions[0].role).toBe("sell");
    expect(sellerView.transactions[0].turn).toBe("them"); // 売り手は入金待ち

    const strangerView = (await (await mine(env, strangerH)).json()) as { transactions: unknown[] };
    expect(strangerView.transactions).toHaveLength(0); // 当事者でないので出さない
  });

  it("完了(sold)や未成立(listed)は取引中一覧に出さない", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("seller2", SESSION_SECRET));
    await transition(env, sellerH, "TX2", { kind: "list_fixed", amount: 5000 }); // listed_fixed のまま(未成立)
    const view = (await (await mine(env, sellerH)).json()) as { transactions: unknown[] };
    expect(view.transactions).toHaveLength(0);
  });
});
