// V3-GOV-10: 掲示板・マーケットの指摘は30回ごとにプラチナ1枚を消費し(クールダウンなし)、
// カルマΔcountとは別経路のプラチナ台帳消費のみとする。市場側(market-flag-routes.ts の
// user flag route + gov-stop route)にのみ配線済み。掲示板側は指摘機能自体が未実装のため
// 未配線(裁定待ち・引継ぎ参照)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { TruthStore } from "@ihl/truth";
import { projectPt } from "../apps/api/src/contribution";
import { GOV_INDICTMENT_PT_FEE_EVERY } from "../apps/api/src/plaza-constants";
import { FakeR2Bucket, makeEnv } from "./helpers";

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}
const authOf = async (actor: string, roles: string[] = []) => bearer(await issueSessionToken(actor, "test-session-secret", roles));
function post(env: object, headers: Record<string, string>, path: string, body: unknown = {}) {
  return app.request(`/api/v1${path}`, { method: "POST", headers, body: JSON.stringify(body) }, env);
}
async function setCountry(env: object, headers: Record<string, string>, country: string) {
  const r = await app.request("/api/v1/me/preferences", { method: "PATCH", headers, body: JSON.stringify({ country }) }, env);
  expect(r.status).toBe(200);
}

describe("V3-GOV-10 市場指摘30回ごとの1PT消費(クールダウンなし)", () => {
  it("30回目の指摘でPT残高が1減る(1〜29回目は減らない)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const sellerH = await authOf("gov10-seller");
    const flaggerH = await authOf("gov10-flagger");
    await setCountry(env, sellerH, "JP");
    await setCountry(env, flaggerH, "JP");
    await post(env, sellerH, "/market/listings/gov10-L1/transition", { kind: "list_fixed" });

    const s = new TruthStore(bucket);
    for (let i = 1; i < GOV_INDICTMENT_PT_FEE_EVERY; i++) {
      const r = await post(env, flaggerH, "/market/listings/gov10-L1/flags", {});
      expect(r.status).toBe(201);
      expect((await projectPt(s, "gov10-flagger")).balance).toBe(0); // unchanged before the 30th
    }
    const last = await post(env, flaggerH, "/market/listings/gov10-L1/flags", {}); // the 30th filing
    expect(last.status).toBe(201);
    expect((await projectPt(s, "gov10-flagger")).balance).toBe(-1); // fee charged (non-blocking; goes negative)
  });

  it("gov-stop(operator role)の指摘も同じ累計カウンタに数える", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const sellerH = await authOf("gov10-seller2");
    const opH = await authOf("gov10-operator", ["operator"]);
    await post(env, sellerH, "/market/listings/gov10-L2/transition", { kind: "list_fixed" });

    const s = new TruthStore(bucket);
    for (let i = 1; i < GOV_INDICTMENT_PT_FEE_EVERY; i++) {
      await post(env, opH, "/market/listings/gov10-L2/gov-stop", {});
    }
    expect((await projectPt(s, "gov10-operator")).balance).toBe(0);
    await post(env, opH, "/market/listings/gov10-L2/gov-stop", {});
    expect((await projectPt(s, "gov10-operator")).balance).toBe(-1);
  });

  it("PT消費イベントはカルマΔcountとは別経路(ihl.economy.pt_event.v1・reason_code=indictment_fee)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const sellerH = await authOf("gov10-seller3");
    const flaggerH = await authOf("gov10-flagger3");
    await setCountry(env, sellerH, "JP");
    await setCountry(env, flaggerH, "JP");
    await post(env, sellerH, "/market/listings/gov10-L3/transition", { kind: "list_fixed" });
    for (let i = 0; i < GOV_INDICTMENT_PT_FEE_EVERY; i++) {
      await post(env, flaggerH, "/market/listings/gov10-L3/flags", {});
    }
    const s = new TruthStore(bucket);
    const ptEvents = (await s.listEvents("truth/ihl.economy.pt_event.v1/"))
      .map((e) => e.data as Record<string, unknown>)
      .filter((d) => d.actor_id === "gov10-flagger3");
    expect(ptEvents).toHaveLength(1);
    expect(ptEvents[0]).toMatchObject({ delta: -1, reason_code: "indictment_fee" });
  });
});
