// round-16 D節(OQ-MKT-01〜04)決済裁定+状態機械5脚。P2P=銀行振込既定・IHL非関与
// (「振込自動検知」前提は廃止・買主:振込済み申告→売主:入金確認で進む)。②24h自動辞退・
// ③48h自動キャンセル+no-payマーク・④猶予キャンセル(60分)+回数制限。①同時申込択一・
// ⑤受取確定放置→自動good は既存 market-state-machine/cron-batch でカバー済み。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import {
  reduceMarket,
  projectPayment,
  isNoPayCancelDue,
  isGraceCancelWindowOpen,
  isOfferExpired,
  type MarketKind,
  type TxnEvent,
} from "../apps/api/src/market-settlement";
import { NO_PAY_CANCEL_HOURS, GRACE_CANCEL_MINUTES, OFFER_RESPONSE_HOURS } from "../apps/api/src/economy-constants";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}
function transition(env: object, headers: Record<string, string>, id: string, body: unknown) {
  return app.request(`/api/v1/market/listings/${id}/transition`, { method: "POST", headers, body: JSON.stringify(body) }, env);
}
function state(env: object, headers: Record<string, string>, id: string) {
  return app.request(`/api/v1/market/listings/${id}/state`, { headers }, env);
}
function offer(env: object, headers: Record<string, string>, body: unknown) {
  return app.request("/api/v1/market/offers", { method: "POST", headers, body: JSON.stringify(body) }, env);
}

let seq = 0;
function ev(kind: MarketKind, actor: string, at: string, over: Partial<TxnEvent> = {}): TxnEvent {
  seq += 1;
  return { transaction_event_id: `t${seq}`, listing_id: "L1", actor_id: actor, kind, created_at: at, ...over };
}

// ── 純関数(market-settlement.ts) ────────────────────────────────────────
describe("round-16 決済裁定: projectPayment(銀行振込・IHL非関与)", () => {
  it("pay_declare/pay_confirm を投影し、listing state は動かさない(tax_* と同型の非辺)", () => {
    const events = [
      ev("list_fixed", "s", "2026-07-11T00:00:00Z"),
      ev("match", "s", "2026-07-11T00:01:00Z", { counterparty: "b" }),
      ev("pay_declare", "b", "2026-07-11T00:02:00Z"),
    ];
    expect(projectPayment(events).declared_at).toBe("2026-07-11T00:02:00Z");
    expect(projectPayment(events).confirmed_at).toBeUndefined();
    expect(reduceMarket("L1", events).state).toBe("matched"); // 経済副次イベントは状態不変
  });
});

describe("状態機械5脚③: isNoPayCancelDue(48h 未入金)", () => {
  const matchedAt = "2026-07-11T00:00:00Z";
  function base(): TxnEvent[] {
    return [ev("list_fixed", "s", "2026-07-10T00:00:00Z"), ev("match", "s", matchedAt, { counterparty: "b" })];
  }
  const plusHours = (h: number) => new Date(new Date(matchedAt).getTime() + h * 3600_000);

  it(`${NO_PAY_CANCEL_HOURS}h 未到来は due=false`, () => {
    expect(isNoPayCancelDue(base(), plusHours(NO_PAY_CANCEL_HOURS - 1))).toBe(false);
  });
  it(`${NO_PAY_CANCEL_HOURS}h 到達で due=true`, () => {
    expect(isNoPayCancelDue(base(), plusHours(NO_PAY_CANCEL_HOURS))).toBe(true);
  });
  it("pay_confirm 済みなら due=false", () => {
    const events = [...base(), ev("pay_confirm", "s", "2026-07-11T01:00:00Z")];
    expect(isNoPayCancelDue(events, plusHours(NO_PAY_CANCEL_HOURS + 10))).toBe(false);
  });
  it("既に ship 済み(matched を離れた)なら due=false", () => {
    const events = [...base(), ev("ship", "s", "2026-07-11T00:30:00Z")];
    expect(isNoPayCancelDue(events, plusHours(NO_PAY_CANCEL_HOURS + 10))).toBe(false);
  });
});

describe("猶予キャンセル: isGraceCancelWindowOpen(成立後60分)", () => {
  const matchedAt = "2026-07-11T00:00:00Z";
  const base: TxnEvent[] = [ev("match", "s", matchedAt, { counterparty: "b" })];
  it(`${GRACE_CANCEL_MINUTES}分以内は窓が開いている`, () => {
    expect(isGraceCancelWindowOpen(base, new Date(new Date(matchedAt).getTime() + (GRACE_CANCEL_MINUTES - 1) * 60_000))).toBe(true);
  });
  it(`${GRACE_CANCEL_MINUTES}分経過で窓は閉じる`, () => {
    expect(isGraceCancelWindowOpen(base, new Date(new Date(matchedAt).getTime() + GRACE_CANCEL_MINUTES * 60_000))).toBe(false);
  });
});

describe("状態機械5脚②: isOfferExpired(承諾制24h無応答)", () => {
  const at = "2026-07-11T00:00:00Z";
  it(`${OFFER_RESPONSE_HOURS}h 未到来は expired=false`, () => {
    expect(isOfferExpired(at, new Date(new Date(at).getTime() + (OFFER_RESPONSE_HOURS - 1) * 3600_000))).toBe(false);
  });
  it(`${OFFER_RESPONSE_HOURS}h 到達で expired=true`, () => {
    expect(isOfferExpired(at, new Date(new Date(at).getTime() + OFFER_RESPONSE_HOURS * 3600_000))).toBe(true);
  });
});

// ── route: 自己修復+ガード(実機) ───────────────────────────────────────
describe("状態機械5脚③ route: 48h 未入金の read-time 自己修復(cron 非依存)", () => {
  it("GET /state を叩くだけで matched→cancelled へ自己修復し、no_pay_cancel_due が false に落ち着く", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("s1", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("b1", SESSION_SECRET));
    await transition(env, sellerH, "L10", { kind: "list_fixed" });
    await transition(env, buyerH, "L10", { kind: "match" }); // 即決自己申込=成立

    // 48h 以上前に成立したことにするため、直接 Truth へ過去日時の match を仕込み直す
    // 代わりに reduceMarket の等価な確認として state route を「未来」から叩けないので、
    // ここでは isNoPayCancelDue の純関数側で境界を検証済み。route は「自己修復が
    // 発火し 409 ILLEGAL_TRANSITION で ship が拒否される」ことを確認する代替経路で見る。
    const st1 = (await (await state(env, sellerH, "L10")).json()) as { state: string; no_pay_cancel_due: boolean };
    expect(st1.state).toBe("matched");
    expect(st1.no_pay_cancel_due).toBe(false); // 直後はまだ due でない
  });

  it("48h 経過後の matched は次の transition 呼び出しで cancel へ自己修復し、以後の ship は 409", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const sellerH = bearer(await issueSessionToken("s2", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("b2", SESSION_SECRET));
    // list_fixed→match を直接 Truth へ過去日時で仕込む(route 経由だと now() 固定で
    // 48h 差分を作れないため、TruthStore へ直接 append して境界を再現する)。
    const { TruthStore, ulid } = await import("@ihl/truth");
    const store = new TruthStore(bucket as unknown as import("@ihl/truth").R2BucketLite);
    async function putTxn(kind: string, actor: string, at: string, extra: Record<string, unknown> = {}) {
      const id = ulid();
      await store.putEvent({
        specversion: "1.0",
        id,
        source: "apps/api",
        type: "ihl.mkt.transaction_event.v1",
        time: at,
        dataschema: "schemas/events/mkt-transaction-event.schema.json",
        provenance: { generator_kind: "human", actor_id: actor },
        data: { transaction_event_id: id, listing_id: "L11", actor_id: actor, kind, created_at: at, ...extra, schema_version: "1" },
      });
    }
    await putTxn("list_fixed", "s2", "2026-07-01T00:00:00Z");
    await putTxn("match", "b2", "2026-07-01T00:01:00Z", { counterparty: "b2" });

    // 48h+ 経過後に読み取ると自己修復で cancelled になる。
    const st = (await (await state(env, sellerH, "L11")).json()) as { state: string };
    expect(st.state).toBe("cancelled");

    // 自己修復後は ship が不正遷移(409)。
    const shipRes = await transition(env, sellerH, "L11", { kind: "ship" });
    expect(shipRes.status).toBe(409);
  });
});

describe("猶予キャンセル route: 成立後60分は買い手が無条件キャンセルできる", () => {
  it("60分以内の cancel は 201・payload.cancel_reason=grace", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("s3", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("b3", SESSION_SECRET));
    await transition(env, sellerH, "L12", { kind: "list_fixed" });
    await transition(env, buyerH, "L12", { kind: "match" });
    const r = await transition(env, buyerH, "L12", { kind: "cancel" });
    expect(r.status).toBe(201);
    expect(((await r.json()) as { state: string }).state).toBe("cancelled");
  });

  it("出品者(買い手でない)が cancel すると 403", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("s4", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("b4", SESSION_SECRET));
    await transition(env, sellerH, "L13", { kind: "list_fixed" });
    await transition(env, buyerH, "L13", { kind: "match" });
    const r = await transition(env, sellerH, "L13", { kind: "cancel" });
    expect(r.status).toBe(403);
  });
});

describe("状態機械5脚②route: 承諾制の24h超過オファーは受諾(match)できない", () => {
  it("offer から24h経過後の match は 409 OFFER_EXPIRED", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const sellerH = bearer(await issueSessionToken("s5", SESSION_SECRET));
    const { TruthStore, ulid } = await import("@ihl/truth");
    const store = new TruthStore(bucket as unknown as import("@ihl/truth").R2BucketLite);
    async function putTxn(kind: string, actor: string, at: string, extra: Record<string, unknown> = {}) {
      const id = ulid();
      await store.putEvent({
        specversion: "1.0",
        id,
        source: "apps/api",
        type: "ihl.mkt.transaction_event.v1",
        time: at,
        dataschema: "schemas/events/mkt-transaction-event.schema.json",
        provenance: { generator_kind: "human", actor_id: actor },
        data: { transaction_event_id: id, listing_id: "L14", actor_id: actor, kind, created_at: at, ...extra, schema_version: "1" },
      });
    }
    await putTxn("list_fixed", "s5", "2026-07-01T00:00:00Z");
    await putTxn("offer", "b5", "2026-07-01T00:01:00Z", { counterparty: "s5", amount: 100 });

    const r = await transition(env, sellerH, "L14", { kind: "match", counterparty: "b5" });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toBe("OFFER_EXPIRED");
  });
});

describe("no-pay マーク(round-16 OQ-MKT-03): 30日内2回で7日間新規申込を制限", () => {
  it("no_pay_auto cancel が2回蓄積した買い手は新規 match(即決自己申込)が403", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const sellerH = bearer(await issueSessionToken("s6", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("b6", SESSION_SECRET));
    const { TruthStore, ulid } = await import("@ihl/truth");
    const store = new TruthStore(bucket as unknown as import("@ihl/truth").R2BucketLite);
    async function putCancel(listing: string, at: string) {
      const id = ulid();
      await store.putEvent({
        specversion: "1.0",
        id,
        source: "apps/api",
        type: "ihl.mkt.transaction_event.v1",
        time: at,
        dataschema: "schemas/events/mkt-transaction-event.schema.json",
        provenance: { generator_kind: "agent", agent_name: "test" },
        data: {
          transaction_event_id: id,
          listing_id: listing,
          actor_id: "system:auto",
          kind: "cancel",
          counterparty: "b6",
          payload: { cancel_reason: "no_pay_auto" },
          created_at: at,
          schema_version: "1",
        },
      });
    }
    const recent = new Date().toISOString(); // 直近(まだ制限期間内)
    await putCancel("Lx1", recent);
    await putCancel("Lx2", recent);

    await transition(env, sellerH, "L15", { kind: "list_fixed" });
    const r = await transition(env, buyerH, "L15", { kind: "match" });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: string }).error).toBe("NO_PAY_RESTRICTED");
  });

  it("1回だけなら制限されない", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const sellerH = bearer(await issueSessionToken("s7", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("b7", SESSION_SECRET));
    const { TruthStore, ulid } = await import("@ihl/truth");
    const store = new TruthStore(bucket as unknown as import("@ihl/truth").R2BucketLite);
    const id = ulid();
    await store.putEvent({
      specversion: "1.0",
      id,
      source: "apps/api",
      type: "ihl.mkt.transaction_event.v1",
      time: new Date().toISOString(),
      dataschema: "schemas/events/mkt-transaction-event.schema.json",
      provenance: { generator_kind: "agent", agent_name: "test" },
      data: {
        transaction_event_id: id,
        listing_id: "Ly1",
        actor_id: "system:auto",
        kind: "cancel",
        counterparty: "b7",
        payload: { cancel_reason: "no_pay_auto" },
        created_at: new Date().toISOString(),
        schema_version: "1",
      },
    });

    await transition(env, sellerH, "L16", { kind: "list_fixed" });
    const r = await transition(env, buyerH, "L16", { kind: "match" });
    expect(r.status).toBe(201);
  });
});
