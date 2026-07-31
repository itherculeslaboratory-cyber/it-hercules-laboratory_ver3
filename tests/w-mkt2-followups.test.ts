// ORDER-2026-08-01-w-mkt2 実装分の最小検査。MKT-36(フォーク貢献度分配配線)・
// MKT-09(好みスコアroute配線)・KRM-22①/KRM-08(取引評価4カウント+問題行為タグ減点)・
// GOV-05(trade_eventへdispute_resolved追記フック)・MKT-28(PII参照/削除可能ストア)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { TruthStore } from "@ihl/truth";
import { appendDisputeResolvedTradeEvent } from "../apps/api/src/market-routes";
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

describe("V3-MKT-36 フォーク10%貢献度分配(market-template-routes.ts fork)", () => {
  it("フォークすると development 軸の contribution_event が親(origin)へも分配される", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const authorH = bearer(await issueSessionToken("tmpl-author", SESSION_SECRET));
    const forkerH = bearer(await issueSessionToken("tmpl-forker", SESSION_SECRET));

    const createRes = (await (await post(env, authorH, "/market/templates", { kind: "prompt", title: "元テンプレ" })).json()) as {
      template_id: string;
    };
    const forkRes = await post(env, forkerH, `/market/templates/${createRes.template_id}/fork`, {});
    expect(forkRes.status).toBe(201);

    const events = (await new TruthStore(bucket).listEvents("truth/ihl.economy.contribution_event.v1/"))
      .map((e) => (e.data ?? {}) as Record<string, unknown>);
    const toAuthor = events.filter((d) => d.node_id === createRes.template_id && d.axis === "development");
    expect(toAuthor.length).toBeGreaterThan(0); // 上流(元テンプレ作者)への分配が発生
  });
});

describe("V3-MKT-09 好みスコアroute配線(POST /market/listings/preference-sort)", () => {
  it("weightに従いスコア降順で並び替わる", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const h = bearer(await issueSessionToken("pref-user", SESSION_SECRET));
    const res = await post(env, h, "/market/listings/preference-sort", {
      specs: { price: { kind: "price", weight: 1, max: 1000 } },
      items: [
        { listing_id: "L-cheap", raw_values: { price: 100 } },
        { listing_id: "L-expensive", raw_values: { price: 900 } },
      ],
    });
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as { results: { listing_id: string }[] };
    expect(results[0].listing_id).toBe("L-cheap"); // 安いほど好みスコアが高い(price kind)
  });
});

describe("V3-KRM-22①/V3-KRM-08 取引評価4カウント+問題行為タグ減点", () => {
  it("said_bad/was_said_bad 等の4カウントを返す・misconduct tagのbad評価はカルマ減点", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = bearer(await issueSessionToken("rate-seller", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("rate-buyer", SESSION_SECRET));
    const buyerActorId = "rate-buyer"; // issueSessionToken(sub) の sub がそのまま actorId

    const listing = (await (await post(env, sellerH, "/market/listings", { title: "評価テスト用出品" })).json()) as {
      listing_id: string;
    };
    await post(env, sellerH, `/market/listings/${listing.listing_id}/transition`, { kind: "list_fixed" });
    await post(env, sellerH, `/market/listings/${listing.listing_id}/transition`, { kind: "match", counterparty: buyerActorId });

    const before = (await (await get(env, sellerH, `/market/users/${buyerActorId}/ratings`)).json()) as {
      karma_value: number;
    };
    const rateRes = await post(env, sellerH, "/market/ratings", {
      listing_id: listing.listing_id,
      ratee_id: buyerActorId,
      grade: "bad",
      reason: "詐欺行為があったため",
      tags: ["fraud"],
    });
    expect(rateRes.status).toBe(201);

    const after = (await (await get(env, sellerH, `/market/users/${buyerActorId}/ratings`)).json()) as {
      was_said_bad: number;
      was_said_bad_counterparts: { actor_id: string }[];
      karma_value: number;
    };
    expect(after.was_said_bad).toBe(1);
    expect(after.was_said_bad_counterparts[0].actor_id).toBeTruthy();
    expect(after.karma_value).toBeLessThan(before.karma_value); // fraud tag → 減点発生
  });
});

describe("V3-GOV-05 trade_eventへdispute_resolved追記フック", () => {
  it("appendDisputeResolvedTradeEvent が kind=dispute_resolved のtrade_eventを1件追記する", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    const res = await appendDisputeResolvedTradeEvent(s, "L-dispute-1", "dispute-1", "seller_favored");
    expect(res.status).toBe("inserted");
    const events = (await s.listEvents("truth/ihl.mkt.transaction_event.v1/")).map((e) => (e.data ?? {}) as Record<string, unknown>);
    const hit = events.find((d) => d.kind === "dispute_resolved" && d.listing_id === "L-dispute-1");
    expect(hit).toBeDefined();
    expect((hit!.payload as Record<string, unknown>).dispute_id).toBe("dispute-1");
  });
});

describe("V3-MKT-28 取引PII参照/削除可能ストア", () => {
  it("owner本人は自分のPIIを登録/参照でき、grant無しの第三者は403", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const ownerH = bearer(await issueSessionToken("pii-owner", SESSION_SECRET));
    const strangerH = bearer(await issueSessionToken("pii-stranger", SESSION_SECRET));
    const ownerId = (await (await get(env, ownerH, "/market/users/pii-owner/ratings")).json()) as { actor_id: string };
    const strangerId = (await (await get(env, strangerH, "/market/users/pii-stranger/ratings")).json()) as { actor_id: string };

    const put = await app.request(
      "/api/v1/market/pii/profile/shipping_address",
      { method: "PUT", headers: ownerH, body: JSON.stringify({ value: "東京都..." }) },
      env,
    );
    expect(put.status).toBe(200);

    const ownRead = await get(env, ownerH, `/market/pii/profile/${ownerId.actor_id}/shipping_address`);
    expect(ownRead.status).toBe(200);

    const strangerRead = await get(env, strangerH, `/market/pii/profile/${ownerId.actor_id}/shipping_address`);
    expect(strangerRead.status).toBe(403);
    void strangerId;
  });

  it("grantした取引相手はtrade_id付きで参照でき、revokedにすると再び403", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const ownerH = bearer(await issueSessionToken("pii-owner2", SESSION_SECRET));
    const partnerH = bearer(await issueSessionToken("pii-partner2", SESSION_SECRET));
    const ownerId = (await (await get(env, ownerH, "/market/users/pii-owner2/ratings")).json()) as { actor_id: string };
    const partnerId = (await (await get(env, partnerH, "/market/users/pii-partner2/ratings")).json()) as { actor_id: string };

    await app.request(
      "/api/v1/market/pii/profile/shipping_address",
      { method: "PUT", headers: ownerH, body: JSON.stringify({ value: "大阪府..." }) },
      env,
    );
    await post(env, ownerH, "/market/pii/grants", {
      trade_id: "T-1",
      slot: "shipping_address",
      granted_to: partnerId.actor_id,
      action: "granted",
    });

    const granted = await get(env, partnerH, `/market/pii/profile/${ownerId.actor_id}/shipping_address?trade_id=T-1`);
    expect(granted.status).toBe(200);

    await post(env, ownerH, "/market/pii/grants", {
      trade_id: "T-1",
      slot: "shipping_address",
      granted_to: partnerId.actor_id,
      action: "revoked",
    });
    const afterRevoke = await get(env, partnerH, `/market/pii/profile/${ownerId.actor_id}/shipping_address?trade_id=T-1`);
    expect(afterRevoke.status).toBe(403);
  });

  it("DELETE(tombstone上書き)後は本人でも404", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const ownerH = bearer(await issueSessionToken("pii-owner3", SESSION_SECRET));
    const ownerId = (await (await get(env, ownerH, "/market/users/pii-owner3/ratings")).json()) as { actor_id: string };
    await app.request(
      "/api/v1/market/pii/profile/bank_account",
      { method: "PUT", headers: ownerH, body: JSON.stringify({ value: "1234567" }) },
      env,
    );
    const del = await app.request("/api/v1/market/pii/profile/bank_account", { method: "DELETE", headers: ownerH }, env);
    expect(del.status).toBe(200);
    const readAfter = await get(env, ownerH, `/market/pii/profile/${ownerId.actor_id}/bank_account`);
    expect(readAfter.status).toBe(404);
  });
});
