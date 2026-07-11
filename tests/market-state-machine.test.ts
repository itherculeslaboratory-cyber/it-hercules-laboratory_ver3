// MKT-01 / MKT-02 マーケット状態機械 TC。純関数 reduceMarket の許可辺畳み込み・
// 末尾状態・チャネル別出品ルール、および route の不正遷移 409 と「非エスクロー=
// 資金非預り(経済台帳を一切触らない)」invariant(design-k3 §2.3)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import {
  reduceMarket,
  isAllowedEdge,
  type MarketKind,
  type TxnEvent,
} from "../apps/api/src/market-settlement";
import { AUTH_HEADERS, FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

let seq = 0;
function ev(kind: MarketKind, actor = "seller", over: Partial<TxnEvent> = {}): TxnEvent {
  seq += 1;
  return {
    transaction_event_id: String(1000 + seq),
    listing_id: "L1",
    actor_id: actor,
    kind,
    created_at: `2026-07-11T00:00:${String(seq).padStart(2, "0")}Z`,
    ...over,
  };
}

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}
function transition(env: object, headers: Record<string, string>, id: string, body: unknown) {
  return app.request(
    `/api/v1/market/listings/${id}/transition`,
    { method: "POST", headers, body: JSON.stringify(body) },
    env,
  );
}

describe("MKT-02 reduceMarket 純関数", () => {
  it("正当な全ライフサイクルを sold まで畳み owner=buyer", () => {
    const m = reduceMarket("L1", [
      ev("list_fixed", "seller"),
      ev("match", "seller", { counterparty: "buyer" }),
      ev("ship", "seller"),
      ev("receive", "buyer"),
      ev("rate", "buyer"),
    ]);
    expect(m.state).toBe("sold");
    expect(m.seller_id).toBe("seller");
    expect(m.matched_with).toBe("buyer");
    expect(m.owner_id).toBe("buyer");
    expect(m.stage).toBe(2);
  });

  it("各 list_* チャネルは対応 listed 状態になる(MKT-01)", () => {
    const cases: [MarketKind, string][] = [
      ["list_fixed", "listed_fixed"],
      ["list_auction", "listed_auction"],
      ["list_lottery", "listed_lottery"],
      ["list_platinum", "listed_platinum"],
    ];
    for (const [kind, state] of cases) {
      expect(reduceMarket("L1", [ev(kind, "s")]).state).toBe(state);
    }
  });

  it("MARKET_EDGES は不正遷移を拒否し、許可辺のみ true", () => {
    expect(isAllowedEdge("unlisted", "ship")).toBe(false);
    expect(isAllowedEdge("listed_auction", "offer")).toBe(false); // オークションは直接オファー不可
    expect(isAllowedEdge("matched", "match")).toBe(false);
    expect(isAllowedEdge("delisted", "match")).toBe(false);
    expect(isAllowedEdge("listed_fixed", "offer")).toBe(true);
  });

  it("経済副次イベント(tax_*)は listing 状態を動かさない", () => {
    const m = reduceMarket("L1", [ev("list_fixed", "s"), ev("tax_debt", "s"), ev("fee_unpaid", "s")]);
    expect(m.state).toBe("listed_fixed");
  });

  it("bid は状態を変えず蓄積し、match で matched へ", () => {
    const m = reduceMarket("L1", [
      ev("list_auction", "s"),
      ev("bid", "b1", { amount: 100 }),
      ev("bid", "b2", { amount: 200 }),
      ev("match", "s", { counterparty: "b2" }),
    ]);
    expect(m.state).toBe("matched");
    expect(m.bids.map((x) => x.amount)).toEqual([100, 200]);
  });
});

describe("MKT-02 route: 許可辺と不正遷移 409", () => {
  it("list_fixed 遷移は 201 listed_fixed", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const r = await transition(env, AUTH_HEADERS, "L1", { kind: "list_fixed" });
    expect(r.status).toBe(201);
    expect(((await r.json()) as { state: string }).state).toBe("listed_fixed");
  });

  it("不正遷移(match 前の ship)は 409", async () => {
    const env = makeEnv(new FakeR2Bucket());
    await transition(env, AUTH_HEADERS, "L1", { kind: "list_fixed" });
    const r = await transition(env, AUTH_HEADERS, "L1", { kind: "ship" });
    expect(r.status).toBe(409);
  });

  it("未知 kind は 400", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const r = await transition(env, AUTH_HEADERS, "L1", { kind: "teleport" });
    expect(r.status).toBe(400);
  });
});

describe("MKT-01 非エスクロー=資金非預り invariant", () => {
  it("全ライフサイクルを route で回しても経済台帳を一切書かない", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const sellerH = bearer(await issueSessionToken("seller-actor", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("buyer-actor", SESSION_SECRET));
    await transition(env, sellerH, "L9", { kind: "list_fixed" });
    await transition(env, sellerH, "L9", { kind: "match", counterparty: "buyer-actor" });
    await transition(env, sellerH, "L9", { kind: "ship" });
    await transition(env, buyerH, "L9", { kind: "receive" });
    await transition(env, buyerH, "L9", { kind: "rate" });

    const state = (await (
      await app.request("/api/v1/market/listings/L9/state", { headers: sellerH }, env)
    ).json()) as { state: string };
    expect(state.state).toBe("sold");

    const economyKeys = [...bucket.objects.keys()].filter((k) => k.startsWith("truth/ihl.economy"));
    expect(economyKeys).toEqual([]); // 資金移動なし=非エスクロー
  });
});
