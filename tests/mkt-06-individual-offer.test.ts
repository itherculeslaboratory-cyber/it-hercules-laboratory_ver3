// V3-MKT-06: 未出品個体への直接オファー(欲しい意思表示)+ 拒否設定(現観測者が個体ごと
// 設定)。既存の POST /market/offers(listing_id必須)とは別経路(ihl.mkt.individual_offer.v1)。
// issueSessionToken(actorId, secret) の第1引数はそのままセッション principal になる
// (market-offer.test.ts と同じ規約・"owner"/"buyer" を actor_id 文字列として直接使う)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore } from "@ihl/truth";
import { issueSessionToken } from "../apps/api/src/session";
import { createIndividualMaster } from "../apps/api/src/individual-routes";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}

async function seedIndividual(bucket: FakeR2Bucket, ownerActorId: string, individualId = "IND-1") {
  const s = new TruthStore(bucket);
  await createIndividualMaster(s, ownerActorId, { individual_id: individualId, species: "test-species" });
  return individualId;
}

describe("V3-MKT-06 個体オファーポリシー", () => {
  it("現観測者のみ設定可(他人は403)・既定は open", async () => {
    const bucket = new FakeR2Bucket();
    const ownerH = bearer(await issueSessionToken("owner", SESSION_SECRET));
    const otherH = bearer(await issueSessionToken("other", SESSION_SECRET));
    await seedIndividual(bucket, "owner");
    const env = makeEnv(bucket);

    const before = (await (await app.request("/api/v1/individuals/IND-1/offer-policy", { headers: ownerH }, env)).json()) as {
      policy: string;
    };
    expect(before.policy).toBe("open");

    const forbidden = await app.request(
      "/api/v1/individuals/IND-1/offer-policy",
      { method: "POST", headers: otherH, body: JSON.stringify({ policy: "closed" }) },
      env,
    );
    expect(forbidden.status).toBe(403);

    const set = await app.request(
      "/api/v1/individuals/IND-1/offer-policy",
      { method: "POST", headers: ownerH, body: JSON.stringify({ policy: "research_only" }) },
      env,
    );
    expect(set.status).toBe(201);
    const after = (await (await app.request("/api/v1/individuals/IND-1/offer-policy", { headers: ownerH }, env)).json()) as {
      policy: string;
    };
    expect(after.policy).toBe("research_only");
  });

  it("不正な policy 値は 400", async () => {
    const bucket = new FakeR2Bucket();
    await seedIndividual(bucket, "owner");
    const ownerH = bearer(await issueSessionToken("owner", SESSION_SECRET));
    const res = await app.request(
      "/api/v1/individuals/IND-1/offer-policy",
      { method: "POST", headers: ownerH, body: JSON.stringify({ policy: "nonsense" }) },
      makeEnv(bucket),
    );
    expect(res.status).toBe(400);
  });
});

describe("V3-MKT-06 個体への直接オファー", () => {
  it("認証なし → 401 / 存在しない個体 → 404", async () => {
    const env401 = makeEnv();
    expect((await app.request("/api/v1/individuals/IND-1/offers", { method: "POST", body: "{}" }, env401)).status).toBe(401);

    const ownerH = bearer(await issueSessionToken("owner", SESSION_SECRET));
    const res404 = await app.request(
      "/api/v1/individuals/no-such-individual/offers",
      { method: "POST", headers: ownerH, body: JSON.stringify({}) },
      makeEnv(),
    );
    expect(res404.status).toBe(404);
  });

  it("自分の個体には出せない(403)", async () => {
    const bucket = new FakeR2Bucket();
    await seedIndividual(bucket, "owner");
    const ownerH = bearer(await issueSessionToken("owner", SESSION_SECRET));
    const res = await app.request(
      "/api/v1/individuals/IND-1/offers",
      { method: "POST", headers: ownerH, body: JSON.stringify({ amount: 1000 }) },
      makeEnv(bucket),
    );
    expect(res.status).toBe(403);
  });

  it("policy=closed は拒否(409)・open は受理、love_letterは金額非開示", async () => {
    const bucket = new FakeR2Bucket();
    await seedIndividual(bucket, "owner");
    const ownerH = bearer(await issueSessionToken("owner", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("buyer", SESSION_SECRET));
    const env = makeEnv(bucket);

    await app.request(
      "/api/v1/individuals/IND-1/offer-policy",
      { method: "POST", headers: ownerH, body: JSON.stringify({ policy: "closed" }) },
      env,
    );
    const rejected = await app.request(
      "/api/v1/individuals/IND-1/offers",
      { method: "POST", headers: buyerH, body: JSON.stringify({ amount: 500 }) },
      env,
    );
    expect(rejected.status).toBe(409);

    await app.request(
      "/api/v1/individuals/IND-1/offer-policy",
      { method: "POST", headers: ownerH, body: JSON.stringify({ policy: "open" }) },
      env,
    );
    const accepted = await app.request(
      "/api/v1/individuals/IND-1/offers",
      { method: "POST", headers: buyerH, body: JSON.stringify({ love_letter: true, amount: 9000, message: "血統に惚れました" }) },
      env,
    );
    expect(accepted.status).toBe(201);

    const list = (await (await app.request("/api/v1/individuals/IND-1/offers", { headers: ownerH }, env)).json()) as {
      offers: { kind: string; amount?: number; message?: string }[];
    };
    expect(list.offers.length).toBe(1);
    expect(list.offers[0].kind).toBe("love_letter");
    expect(list.offers[0].amount).toBeUndefined(); // 値段非開示
    expect(list.offers[0].message).toContain("血統");
  });

  it("policy=research_only は purpose=research 以外を 409 で拒否", async () => {
    const bucket = new FakeR2Bucket();
    await seedIndividual(bucket, "owner");
    const ownerH = bearer(await issueSessionToken("owner", SESSION_SECRET));
    const buyerH = bearer(await issueSessionToken("buyer", SESSION_SECRET));
    const env = makeEnv(bucket);
    await app.request(
      "/api/v1/individuals/IND-1/offer-policy",
      { method: "POST", headers: ownerH, body: JSON.stringify({ policy: "research_only" }) },
      env,
    );
    const personal = await app.request(
      "/api/v1/individuals/IND-1/offers",
      { method: "POST", headers: buyerH, body: JSON.stringify({ amount: 100 }) },
      env,
    );
    expect(personal.status).toBe(409);
    const research = await app.request(
      "/api/v1/individuals/IND-1/offers",
      { method: "POST", headers: buyerH, body: JSON.stringify({ amount: 100, purpose: "research" }) },
      env,
    );
    expect(research.status).toBe(201);
  });

  it("第三者は他人宛オファー一覧を見られない(現観測者のみ)", async () => {
    const bucket = new FakeR2Bucket();
    await seedIndividual(bucket, "owner");
    const buyerH = bearer(await issueSessionToken("buyer", SESSION_SECRET));
    const env = makeEnv(bucket);
    await app.request(
      "/api/v1/individuals/IND-1/offers",
      { method: "POST", headers: buyerH, body: JSON.stringify({ amount: 100 }) },
      env,
    );
    const forbidden = await app.request("/api/v1/individuals/IND-1/offers", { headers: buyerH }, env);
    expect(forbidden.status).toBe(403);
  });
});
