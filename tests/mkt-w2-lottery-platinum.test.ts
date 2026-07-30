// V3-MKT-07(抽選出品 TX-LOTTERY)・V3-MKT-08(プラチナコイン優先 TX-PLATINUM-PRIORITY)
// 締切(ends_at)経過の read-time 自己修復(settleDueLottery/settleDuePlatinum)。
// パターンは既存 market-auction-settle.test.ts(V3-MKT-05)と同型: 締切前の応募を
// Truth へ直接 seed し、締切経過後の GET /state で自動決着を検証する。
import { describe, expect, it } from "vitest";
import { TruthStore, ulid } from "@ihl/truth";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

async function seedBid(bucket: FakeR2Bucket, listingId: string, bidder: string, amount: number | undefined, createdAt: string) {
  const s = new TruthStore(bucket);
  const id = ulid();
  const data: Record<string, unknown> = {
    transaction_event_id: id,
    listing_id: listingId,
    actor_id: bidder,
    kind: "bid",
    created_at: createdAt,
    schema_version: "1",
  };
  if (amount !== undefined) data.amount = amount;
  const res = await s.putEvent({
    specversion: "1.0",
    id,
    source: "apps/api",
    type: "ihl.mkt.transaction_event.v1",
    time: new Date().toISOString(),
    dataschema: "schemas/events/mkt-transaction-event.schema.json",
    provenance: { generator_kind: "human", actor_id: bidder },
    data,
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
const PAST = "2020-01-01T00:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";

describe("V3-MKT-07 抽選出品の自動抽選", () => {
  it("締切経過+応募1件はその応募者へmatch(CSPRNGでも唯一の候補は必ず当選)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const sellerH = bearer(await issueSessionToken("lot-seller1", SESSION_SECRET));
    const listingId = ((await (
      await post(env, sellerH, "/market/listings", { title: "抽選出品", ends_at: PAST })
    ).json()) as { listing_id: string }).listing_id;
    await transition(env, sellerH, listingId, { kind: "list_lottery" });
    await seedBid(bucket, listingId, "lot-applicant1", undefined, new Date().toISOString());

    const st = (await (await state(env, sellerH, listingId)).json()) as { state: string; matched_with?: string };
    expect(st.state).toBe("matched");
    expect(st.matched_with).toBe("lot-applicant1");
  });

  it("締切経過+応募なしはdelist", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("lot-seller2", SESSION_SECRET));
    const listingId = ((await (
      await post(env, sellerH, "/market/listings", { title: "抽選出品(応募なし)", ends_at: PAST })
    ).json()) as { listing_id: string }).listing_id;
    await transition(env, sellerH, listingId, { kind: "list_lottery" });

    const st = (await (await state(env, sellerH, listingId)).json()) as { state: string };
    expect(st.state).toBe("delisted");
  });

  it("同一actorの2回目応募は409(1応募/listing)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("lot-seller3", SESSION_SECRET));
    const applicantH = bearer(await issueSessionToken("lot-applicant3", SESSION_SECRET));
    const listingId = ((await (
      await post(env, sellerH, "/market/listings", { title: "抽選出品(締切先)", ends_at: FUTURE })
    ).json()) as { listing_id: string }).listing_id;
    await transition(env, sellerH, listingId, { kind: "list_lottery" });
    const first = await transition(env, applicantH, listingId, { kind: "bid" });
    expect(first.status).toBe(201);
    const second = await transition(env, applicantH, listingId, { kind: "bid" });
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: string }).error).toBe("ALREADY_APPLIED");
  });

  it("応募にamountを付けると400(価格UIを出さない=当選率を金額で操作できない)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("lot-seller4", SESSION_SECRET));
    const applicantH = bearer(await issueSessionToken("lot-applicant4", SESSION_SECRET));
    const listingId = ((await (
      await post(env, sellerH, "/market/listings", { title: "抽選出品(締切先)", ends_at: FUTURE })
    ).json()) as { listing_id: string }).listing_id;
    await transition(env, sellerH, listingId, { kind: "list_lottery" });
    const res = await transition(env, applicantH, listingId, { kind: "bid", amount: 100 });
    expect(res.status).toBe(400);
  });
});

describe("V3-MKT-08 プラチナコイン優先の自動決着", () => {
  it("締切経過は累計PT降順の上位1名へmatch(Pay To Win禁止=申告額の比較のみ)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const sellerH = bearer(await issueSessionToken("plat-seller1", SESSION_SECRET));
    const listingId = ((await (
      await post(env, sellerH, "/market/listings", { title: "プラチナ優先出品", ends_at: PAST })
    ).json()) as { listing_id: string }).listing_id;
    await transition(env, sellerH, listingId, { kind: "list_platinum" });
    await seedBid(bucket, listingId, "plat-low1", 50, new Date().toISOString());
    await seedBid(bucket, listingId, "plat-high1", 200, new Date().toISOString());

    const st = (await (await state(env, sellerH, listingId)).json()) as { state: string; matched_with?: string };
    expect(st.state).toBe("matched");
    expect(st.matched_with).toBe("plat-high1");
  });

  it("応募amountが現在の最高累計PT未満は409(最低=現在の最高累計PT)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("plat-seller2", SESSION_SECRET));
    const buyerA = bearer(await issueSessionToken("plat-buyerA", SESSION_SECRET));
    const buyerB = bearer(await issueSessionToken("plat-buyerB", SESSION_SECRET));
    const listingId = ((await (
      await post(env, sellerH, "/market/listings", { title: "プラチナ優先出品(締切先)", ends_at: FUTURE })
    ).json()) as { listing_id: string }).listing_id;
    await transition(env, sellerH, listingId, { kind: "list_platinum" });
    const ok = await transition(env, buyerA, listingId, { kind: "bid", amount: 100 });
    expect(ok.status).toBe(201);
    const tooLow = await transition(env, buyerB, listingId, { kind: "bid", amount: 50 });
    expect(tooLow.status).toBe(409);
    expect(((await tooLow.json()) as { error: string }).error).toBe("BID_TOO_LOW");
  });

  it("amount省略/非整数は400", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("plat-seller3", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("plat-buyer3", SESSION_SECRET));
    const listingId = ((await (
      await post(env, sellerH, "/market/listings", { title: "プラチナ優先出品(締切先)", ends_at: FUTURE })
    ).json()) as { listing_id: string }).listing_id;
    await transition(env, sellerH, listingId, { kind: "list_platinum" });
    const res = await transition(env, buyerH, listingId, { kind: "bid" });
    expect(res.status).toBe(400);
  });

  it("締切経過+応募なしはdelist", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("plat-seller4", SESSION_SECRET));
    const listingId = ((await (
      await post(env, sellerH, "/market/listings", { title: "プラチナ優先出品(応募なし)", ends_at: PAST })
    ).json()) as { listing_id: string }).listing_id;
    await transition(env, sellerH, listingId, { kind: "list_platinum" });

    const st = (await (await state(env, sellerH, listingId)).json()) as { state: string };
    expect(st.state).toBe("delisted");
  });
});
