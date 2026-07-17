// V3-MKT-05 オークション自動決着(settleDueAuctions・read-time自己修復)。締切(ends_at)
// 経過で listed_auction のまま止まっているオークションを、最高入札があれば match
// (=matched)、無ければ delist(「入札なしでも決着」)へ自動遷移させる。価格帯別
// 入札単位刻み+ヤフオク型自動入札(予算上限までの自動再入札)は既存の無条件 bid
// append 経路を壊さないよう本波では対象外(決着ロジックのみ先行実装・ponytail)。
import { describe, expect, it } from "vitest";
import { TruthStore, ulid } from "@ihl/truth";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

// bid を実 route(POST /transition)経由で置くと、ends_at が既に過去の場合は「bid を
// 置こうとした瞬間」自体が settleDueAuctions の対象になり得札前に auto-delist されて
// しまう(現実には ends_at は作成時=未来で、時間経過後に締切を迎える想定)。ここでは
// 「締切前に複数入札があった」状態を Truth へ直接 seed して現実のタイムラインを再現する
// (既存 market-pricing.test.ts の txn 直接 seed パターンと同型)。
async function seedBid(bucket: FakeR2Bucket, listingId: string, bidder: string, amount: number, createdAt: string) {
  const s = new TruthStore(bucket);
  const id = ulid();
  const res = await s.putEvent({
    specversion: "1.0",
    id,
    source: "apps/api",
    type: "ihl.mkt.transaction_event.v1",
    time: new Date().toISOString(),
    dataschema: "schemas/events/mkt-transaction-event.schema.json",
    provenance: { generator_kind: "human", actor_id: bidder },
    data: {
      transaction_event_id: id,
      listing_id: listingId,
      actor_id: bidder,
      kind: "bid",
      amount,
      created_at: createdAt,
      schema_version: "1",
    },
  });
  if (res.status !== "inserted") throw new Error(`seed bid failed: ${res.status}`);
}

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}
function post(env: object, headers: Record<string, string>, path: string, body: unknown) {
  return app.request(`/api/v1${path}`, { method: "POST", headers, body: JSON.stringify(body) }, env);
}
function transition(env: object, headers: Record<string, string>, id: string, body: unknown) {
  return post(env, headers, `/market/listings/${id}/transition`, body);
}
function state(env: object, headers: Record<string, string>, id: string) {
  return app.request(`/api/v1/market/listings/${id}/state`, { headers }, env);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PAST = "2020-01-01T00:00:00.000Z"; // 常に「締切経過」扱いの固定過去日時
const FUTURE = "2999-01-01T00:00:00.000Z";

describe("V3-MKT-05 オークション自動決着", () => {
  it("締切経過+入札ありは最高額入札者へmatch(matched・落札額=最高額)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const sellerH = bearer(await issueSessionToken("auc-seller1", SESSION_SECRET));
    const listingId = ((await (
      await post(env, sellerH, "/market/listings", { title: "オークション出品", ends_at: PAST })
    ).json()) as { listing_id: string }).listing_id;
    await transition(env, sellerH, listingId, { kind: "list_auction" });
    // 締切前(現実には ends_at=未来の時点)に複数入札があった状態を直接 seed する(HTTP
    // route 経由だと ends_at=過去のこのシナリオでは bid 到達前に auto-delist されて
    // しまうため=上の注記どおり)。
    await seedBid(bucket, listingId, "auc-low1", 500, new Date().toISOString());
    await sleep(2);
    await seedBid(bucket, listingId, "auc-high1", 900, new Date().toISOString());

    const st = (await (await state(env, sellerH, listingId)).json()) as {
      state: string;
      matched_with?: string;
      bids: { bidder: string; amount?: number }[];
    };
    expect(st.state).toBe("matched"); // 締切経過で自動決着(read-time)
    expect(st.matched_with).toBe("auc-high1"); // 最高額入札者
  });

  it("締切経過+入札なしはdelistへ自動決着(「入札なしでも決着」)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("auc-seller2", SESSION_SECRET));
    const listingId = ((await (
      await post(env, sellerH, "/market/listings", { title: "オークション出品(入札なし)", ends_at: PAST })
    ).json()) as { listing_id: string }).listing_id;
    await transition(env, sellerH, listingId, { kind: "list_auction" });

    const st = (await (await state(env, sellerH, listingId)).json()) as { state: string };
    expect(st.state).toBe("delisted");
  });

  it("締切未到来(ends_at=未来)はlisted_auctionのまま(自動決着しない)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("auc-seller3", SESSION_SECRET));
    const bidderH = bearer(await issueSessionToken("auc-bidder3", SESSION_SECRET));
    const listingId = ((await (
      await post(env, sellerH, "/market/listings", { title: "オークション出品(締切先)", ends_at: FUTURE })
    ).json()) as { listing_id: string }).listing_id;
    await transition(env, sellerH, listingId, { kind: "list_auction" });
    await sleep(2);
    await transition(env, bidderH, listingId, { kind: "bid", amount: 700 });

    const st = (await (await state(env, sellerH, listingId)).json()) as { state: string };
    expect(st.state).toBe("listed_auction");
  });

  it("ends_at省略(通常オークション)は従来どおり手動matchのまま自動決着しない", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("auc-seller4", SESSION_SECRET));
    const listingId = ((await (
      await post(env, sellerH, "/market/listings", { title: "オークション出品(締切なし)" })
    ).json()) as { listing_id: string }).listing_id;
    await transition(env, sellerH, listingId, { kind: "list_auction" });

    const st = (await (await state(env, sellerH, listingId)).json()) as { state: string };
    expect(st.state).toBe("listed_auction");
  });

  it("自動決着は冪等(二重読み出しでも二重matchしない)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const sellerH = bearer(await issueSessionToken("auc-seller5", SESSION_SECRET));
    const listingId = ((await (
      await post(env, sellerH, "/market/listings", { title: "オークション出品", ends_at: PAST })
    ).json()) as { listing_id: string }).listing_id;
    await transition(env, sellerH, listingId, { kind: "list_auction" });
    await seedBid(bucket, listingId, "auc-bidder5", 400, new Date().toISOString());

    await state(env, sellerH, listingId);
    const st2 = (await (await state(env, sellerH, listingId)).json()) as { state: string; matched_with?: string };
    expect(st2.state).toBe("matched");
    expect(st2.matched_with).toBe("auc-bidder5");
  });
});
