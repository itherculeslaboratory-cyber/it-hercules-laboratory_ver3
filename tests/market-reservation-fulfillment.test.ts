// HANDOFF §3.4 残作業: 予約成立(confirm)後のfulfillment配線。V3-IND-35の予約は
// 1 listing = 複数買い手のため専用の状態機械(match_offer/confirm/decline/expire)を
// 持つが、confirm成立後の実配送/決済/評価までは独自実装せず、既存のsingular-buyer
// 取引状態機械(ship/pay_declare/pay_confirm/receive/rate/cancel_request・V3-MKT-10
// 手数料自動計上込み)をreservation_idをlisting_idとして流用し再利用する。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { FEE_MAINTENANCE_TAX_RATE } from "../apps/api/src/economy-constants";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}
function post(env: object, headers: Record<string, string>, path: string, body: unknown) {
  return app.request(`/api/v1${path}`, { method: "POST", headers, body: JSON.stringify(body) }, env);
}
function get(env: object, headers: Record<string, string>, path: string) {
  return app.request(`/api/v1${path}`, { headers }, env);
}
async function makeReservationListing(env: object, sellerH: Record<string, string>) {
  const r = await post(env, sellerH, "/market/listings", {
    title: "割り出し予約: DHH ♂×♀",
    reservation_sire_id: "IND-SIRE-1",
    reservation_dam_id: "IND-DAM-1",
  });
  expect(r.status).toBe(201);
  return ((await r.json()) as { listing_id: string }).listing_id;
}
// ULID は同一ミリ秒内で単調増加しない(packages/truth/src/ulid.ts)ため、既存 market TC と
// 同じ回避策(2ms 空けて created_at を確実に進める)を連続 transition 間に挟む。
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("HANDOFF §3.4 予約confirm成立後のfulfillment配線", () => {
  it("confirm成立で通常の取引状態機械(matched)へ自動接続され、ship→pay→receive→rateまで通貫できる", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("res-breeder1", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("res-buyer1", SESSION_SECRET));
    const listingId = await makeReservationListing(env, sellerH);
    const resR = await post(env, buyerH, "/market/reservations", { listing_id: listingId, desired_unit_price: 3000, desired_count: 1 });
    const { reservation_id } = (await resR.json()) as { reservation_id: string };
    await post(env, sellerH, `/market/listings/${listingId}/match`, { harvested_count: 5 });

    const confirmR = await post(env, buyerH, `/market/reservations/${reservation_id}/confirm`, {});
    expect(confirmR.status).toBe(201);
    const confirmBody = (await confirmR.json()) as { status: string; fulfillment_listing_id: string };
    expect(confirmBody.fulfillment_listing_id).toBe(reservation_id);

    // reservation_id をそのまま listing_id として通常の取引状態機械が使える(matched)。
    const st0 = (await (await get(env, sellerH, `/market/listings/${reservation_id}/state`)).json()) as {
      state: string;
      seller_id?: string;
      matched_with?: string;
    };
    expect(st0.state).toBe("matched");
    expect(st0.seller_id).toBe("res-breeder1");
    expect(st0.matched_with).toBe("res-buyer1");

    await sleep(2);
    await post(env, buyerH, `/market/listings/${reservation_id}/transition`, { kind: "pay_declare", amount: 3000 });
    await sleep(2);
    await post(env, sellerH, `/market/listings/${reservation_id}/transition`, { kind: "pay_confirm", amount: 3000 });
    await sleep(2);
    await post(env, sellerH, `/market/listings/${reservation_id}/transition`, { kind: "ship" });
    await sleep(2);
    await post(env, buyerH, `/market/listings/${reservation_id}/transition`, { kind: "receive" });
    await sleep(2);
    const rate = await post(env, buyerH, `/market/listings/${reservation_id}/transition`, { kind: "rate" });
    expect(rate.status).toBe(201);
    expect(((await rate.json()) as { state: string }).state).toBe("sold");

    // V3-MKT-10: 成立で5%維持費税が自動計上される(このfulfillmentスレッドにも同じ配線が効く)。
    const fees = (await (await get(env, sellerH, "/me/fees")).json()) as { items: { amount: number }[] };
    expect(fees.items).toHaveLength(1);
    expect(fees.items[0].amount).toBe(Math.round(3000 * FEE_MAINTENANCE_TAX_RATE));
  });

  it("confirmを2回叩いても fulfillment スレッドは二重シードされない(冪等)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("res-breeder2", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("res-buyer2", SESSION_SECRET));
    const listingId = await makeReservationListing(env, sellerH);
    const resR = await post(env, buyerH, "/market/reservations", { listing_id: listingId, desired_unit_price: 1000, desired_count: 2 });
    const { reservation_id } = (await resR.json()) as { reservation_id: string };
    await post(env, sellerH, `/market/listings/${listingId}/match`, { harvested_count: 5 });

    const first = await post(env, buyerH, `/market/reservations/${reservation_id}/confirm`, {});
    expect(first.status).toBe(201);
    const second = await post(env, buyerH, `/market/reservations/${reservation_id}/confirm`, {}); // ALREADY_RESOLVED(409)だが直前のシードは既に効いている
    expect(second.status).toBe(409);

    const st = (await (await get(env, sellerH, `/market/listings/${reservation_id}/state`)).json()) as { state: string };
    expect(st.state).toBe("matched"); // list_fixed→match の2重シードで壊れていない
  });
});
