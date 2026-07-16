// V3-IND-35 割り出し予約システム(round-15新規・第1波S tier / round-16 OQ-ROUTE-03
// 実装先)。予約作成→割り出し完了後の単価降順自動マッチング→確認画面→confirm(成立)
// or decline/expire(未確定=カルマ-1)。応募単位しきい値・ブロック関係(V3-MKT-61)適用。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";
import { TruthStore } from "@ihl/truth";

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}
function post(env: object, headers: Record<string, string>, path: string, body: unknown) {
  return app.request(`/api/v1${path}`, { method: "POST", headers, body: JSON.stringify(body) }, env);
}
function get(env: object, headers: Record<string, string>, path: string) {
  return app.request(`/api/v1${path}`, { headers }, env);
}
async function ledger(env: object, headers: Record<string, string>) {
  return (await (await get(env, headers, "/me/ledger")).json()) as { karma_count: number };
}

async function makeReservationListing(env: object, sellerH: Record<string, string>, over: Record<string, unknown> = {}) {
  const r = await post(env, sellerH, "/market/listings", {
    title: "割り出し予約: DHH ♂×♀",
    reservation_sire_id: "IND-SIRE-1",
    reservation_dam_id: "IND-DAM-1",
    ...over,
  });
  expect(r.status).toBe(201);
  return ((await r.json()) as { listing_id: string }).listing_id;
}

describe("V3-IND-35 予約作成", () => {
  it("予約 listing に単価・匹数を宣言できる", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("breeder", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("buyer1", SESSION_SECRET));
    const listingId = await makeReservationListing(env, sellerH);

    const r = await post(env, buyerH, "/market/reservations", { listing_id: listingId, desired_unit_price: 3000, desired_count: 2 });
    expect(r.status).toBe(201);
    const { reservation_id } = (await r.json()) as { reservation_id: string };
    expect(reservation_id).toBeTruthy();

    const mine = (await (await get(env, buyerH, "/market/reservations")).json()) as { reservations: { status: string }[] };
    expect(mine.reservations[0].status).toBe("pending");
  });

  it("予約 listing でない listing には予約できない(400)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("s", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("b", SESSION_SECRET));
    const r0 = await post(env, sellerH, "/market/listings", { title: "普通の出品" });
    const { listing_id } = (await r0.json()) as { listing_id: string };
    const r = await post(env, buyerH, "/market/reservations", { listing_id, desired_unit_price: 100, desired_count: 1 });
    expect(r.status).toBe(400);
  });

  it("自分の予約 listing には予約できない(403)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("breeder2", SESSION_SECRET));
    const listingId = await makeReservationListing(env, sellerH);
    const r = await post(env, sellerH, "/market/reservations", { listing_id: listingId, desired_unit_price: 100, desired_count: 1 });
    expect(r.status).toBe(403);
  });

  it("ブロック関係とは予約できない(V3-MKT-61)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("breeder3", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("buyerX", SESSION_SECRET));
    const listingId = await makeReservationListing(env, sellerH);
    await post(env, sellerH, "/market/blocks", { blocked_actor_id: "buyerX" });
    const r = await post(env, buyerH, "/market/reservations", { listing_id: listingId, desired_unit_price: 100, desired_count: 1 });
    expect(r.status).toBe(403);
  });
});

describe("V3-IND-35 自動マッチング(POST /market/listings/{id}/match・OQ-ROUTE-03)", () => {
  it("単価降順で harvested_count に収まる分だけ match_offer が発行される", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("breeder4", SESSION_SECRET));
    const highH = bearer(await issueSessionToken("high", SESSION_SECRET));
    const midH = bearer(await issueSessionToken("mid", SESSION_SECRET));
    const lowH = bearer(await issueSessionToken("low", SESSION_SECRET));
    const listingId = await makeReservationListing(env, sellerH);

    await post(env, lowH, "/market/reservations", { listing_id: listingId, desired_unit_price: 1000, desired_count: 3 });
    await post(env, highH, "/market/reservations", { listing_id: listingId, desired_unit_price: 5000, desired_count: 2 });
    await post(env, midH, "/market/reservations", { listing_id: listingId, desired_unit_price: 3000, desired_count: 3 });

    // 実匹数5: high(2)を最優先で確保→残3→mid(3)確保→残0→low(3)は収まらず unmatched。
    const r = await post(env, sellerH, `/market/listings/${listingId}/match`, { harvested_count: 5 });
    expect(r.status).toBe(201);
    const body = (await r.json()) as { matched: string[]; unmatched: string[]; remaining_count: number };
    expect(body.matched.length).toBe(2);
    expect(body.unmatched.length).toBe(1);
    expect(body.remaining_count).toBe(0);

    // 出品者のみ全件閲覧できる確認画面(GET /market/transfer/{listing_id})。
    const manifest = (await (await get(env, sellerH, `/market/transfer/${listingId}`)).json()) as {
      reservations: { actor_id: string; status: string; rank?: number }[];
    };
    expect(manifest.reservations.length).toBe(3);
    const high = manifest.reservations.find((x) => x.actor_id === "high")!;
    const mid = manifest.reservations.find((x) => x.actor_id === "mid")!;
    const low = manifest.reservations.find((x) => x.actor_id === "low")!;
    expect(high.status).toBe("offered");
    expect(high.rank).toBe(0); // 単価最高が rank0
    expect(mid.status).toBe("offered");
    expect(low.status).toBe("pending"); // unmatched(閾値外/収まらず) は match_offer が無い=pending
  });

  it("出品者以外はマッチング実行できない(403)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("breeder5", SESSION_SECRET));
    const strangerH = bearer(await issueSessionToken("stranger", SESSION_SECRET));
    const listingId = await makeReservationListing(env, sellerH);
    const r = await post(env, strangerH, `/market/listings/${listingId}/match`, { harvested_count: 5 });
    expect(r.status).toBe(403);
  });

  it("同一 listing への再マッチングは 409(ALREADY_MATCHED)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("breeder6", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("buyer6", SESSION_SECRET));
    const listingId = await makeReservationListing(env, sellerH);
    await post(env, buyerH, "/market/reservations", { listing_id: listingId, desired_unit_price: 100, desired_count: 1 });
    await post(env, sellerH, `/market/listings/${listingId}/match`, { harvested_count: 5 });
    const r = await post(env, sellerH, `/market/listings/${listingId}/match`, { harvested_count: 5 });
    expect(r.status).toBe(409);
  });

  it("応募単位しきい値(min/max)の範囲外は自動マッチング対象外", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("breeder7", SESSION_SECRET));
    const tooFewH = bearer(await issueSessionToken("toofew", SESSION_SECRET));
    const okH = bearer(await issueSessionToken("ok", SESSION_SECRET));
    const listingId = await makeReservationListing(env, sellerH, {
      reservation_min_apply_count: 3,
      reservation_max_apply_count: 10,
    });
    await post(env, tooFewH, "/market/reservations", { listing_id: listingId, desired_unit_price: 9000, desired_count: 1 }); // 高単価でも閾値未満
    await post(env, okH, "/market/reservations", { listing_id: listingId, desired_unit_price: 1000, desired_count: 3 });

    const r = await post(env, sellerH, `/market/listings/${listingId}/match`, { harvested_count: 10 });
    const body = (await r.json()) as { matched: string[]; unmatched: string[] };
    expect(body.matched.length).toBe(1);
    expect(body.unmatched.length).toBe(1); // 閾値未満は unmatched に回る
  });
});

describe("V3-IND-35 確認画面: confirm(成立)/decline(未確定=カルマ-1)", () => {
  it("買い手が confirm すると成立し、閲覧は本人分のみに絞られる", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("breeder8", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("buyer8", SESSION_SECRET));
    const listingId = await makeReservationListing(env, sellerH);
    const resR = await post(env, buyerH, "/market/reservations", { listing_id: listingId, desired_unit_price: 3000, desired_count: 1 });
    const { reservation_id } = (await resR.json()) as { reservation_id: string };
    await post(env, sellerH, `/market/listings/${listingId}/match`, { harvested_count: 5 });

    const buyerView = (await (await get(env, buyerH, `/market/transfer/${listingId}`)).json()) as { reservations: unknown[] };
    expect(buyerView.reservations.length).toBe(1); // 本人分のみ

    const confirmR = await post(env, buyerH, `/market/reservations/${reservation_id}/confirm`, {});
    expect(confirmR.status).toBe(201);
    expect(((await confirmR.json()) as { status: string }).status).toBe("confirmed");
  });

  it("他人の予約は confirm できない(403)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("breeder9", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("buyer9", SESSION_SECRET));
    const otherH = bearer(await issueSessionToken("other9", SESSION_SECRET));
    const listingId = await makeReservationListing(env, sellerH);
    const resR = await post(env, buyerH, "/market/reservations", { listing_id: listingId, desired_unit_price: 3000, desired_count: 1 });
    const { reservation_id } = (await resR.json()) as { reservation_id: string };
    await post(env, sellerH, `/market/listings/${listingId}/match`, { harvested_count: 5 });

    const r = await post(env, otherH, `/market/reservations/${reservation_id}/confirm`, {});
    expect(r.status).toBe(403);
  });

  it("decline すると未確定=カルマ-1(「予約するなら購入する責任」)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("breeder10", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("buyer10", SESSION_SECRET));
    const listingId = await makeReservationListing(env, sellerH);
    const resR = await post(env, buyerH, "/market/reservations", { listing_id: listingId, desired_unit_price: 3000, desired_count: 1 });
    const { reservation_id } = (await resR.json()) as { reservation_id: string };
    await post(env, sellerH, `/market/listings/${listingId}/match`, { harvested_count: 5 });

    const before = await ledger(env, buyerH);
    expect(before.karma_count).toBe(0);
    const r = await post(env, buyerH, `/market/reservations/${reservation_id}/decline`, {});
    expect(r.status).toBe(201);
    const after = await ledger(env, buyerH);
    expect(after.karma_count).toBe(1); // カルマカウント+1(=Fib減点1段)
  });

  it("応答期限超過は read-time 自己修復で expire+カルマ-1(cron 非依存・確認画面 GET を叩くだけで発火)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const sellerH = bearer(await issueSessionToken("breeder11", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("buyer11", SESSION_SECRET));
    const listingId = await makeReservationListing(env, sellerH);
    const resR = await post(env, buyerH, "/market/reservations", { listing_id: listingId, desired_unit_price: 3000, desired_count: 1 });
    const { reservation_id } = (await resR.json()) as { reservation_id: string };

    // match_offer を「既に期限切れ」の状態で直接 Truth へ仕込む(route 経由だと
    // expires_at=now+24h 固定で期限切れを即時再現できないため)。
    const store = new TruthStore(bucket as unknown as import("@ihl/truth").R2BucketLite);
    const past = new Date(Date.now() - 1000).toISOString();
    await store.putEventAt(`truth/ihl.mkt.reservation_event.v1/${reservation_id}-match-offer.json`, {
      specversion: "1.0",
      id: "01JAAAAAAAAAAAAAAAAAAAAAAA",
      source: "apps/api",
      type: "ihl.mkt.reservation_event.v1",
      time: past,
      dataschema: "schemas/events/mkt-reservation-event.schema.json",
      provenance: { generator_kind: "agent", agent_name: "market-reservation-match" },
      data: {
        event_id: "01JAAAAAAAAAAAAAAAAAAAAAAA",
        reservation_id,
        listing_id: listingId,
        kind: "match_offer",
        actor_id: "system:reservation-match",
        offered_count: 1,
        offered_unit_price: 3000,
        rank: 0,
        expires_at: past,
        created_at: past,
        schema_version: "1",
      },
    });

    const before = await ledger(env, buyerH);
    expect(before.karma_count).toBe(0);

    // 確認画面 GET を叩くだけで期限切れの自己修復(expire+カルマ-1)が発火する。
    const manifest = (await (await get(env, sellerH, `/market/transfer/${listingId}`)).json()) as {
      reservations: { status: string }[];
    };
    expect(manifest.reservations[0].status).toBe("expired");
    expect((await ledger(env, buyerH)).karma_count).toBe(1);

    expect(await store.readEvent(`truth/ihl.mkt.reservation_event.v1/${reservation_id}-auto-expire.json`)).not.toBeNull();

    // confirm はもう通らない(EXPIRED)。
    const confirmR = await post(env, buyerH, `/market/reservations/${reservation_id}/confirm`, {});
    expect(confirmR.status).toBe(409);
    expect(((await confirmR.json()) as { error: string }).error).toBe("EXPIRED");

    // 二重ペナルティなし(自己修復は put-if-absent で冪等)。
    expect((await ledger(env, buyerH)).karma_count).toBe(1);
  });
});
