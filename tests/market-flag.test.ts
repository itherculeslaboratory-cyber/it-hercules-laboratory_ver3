// V3-GOV-35(round-15拡張・違法出品ユーザー自治)TC。同国ユーザー間の指摘5件で
// 出品を非表示・非表示5件蓄積した出品者は新規出品停止・国やそれに準ずる立場
// (requireRole operator/admin)からの指摘は近似範囲(同一出品者の全出品)をまるごと
// 停止・誤BAN復帰はカルマ80以上5人の判定(/gov/votes kind=misban_reversal)でのみ解除。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { TruthStore, ulid } from "@ihl/truth";
import { appendKarma, projectLedger } from "../apps/api/src/ledger-routes";
import { projectContribution } from "../apps/api/src/contribution";
import { MKT_LISTING_FLAG_KARMA_STEPS } from "../apps/api/src/plaza-constants";
import { AUTH_HEADERS, FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}
const authOf = async (actor: string, roles: string[] = []) => bearer(await issueSessionToken(actor, SESSION_SECRET, roles));

function post(env: object, headers: Record<string, string>, path: string, body: unknown = {}) {
  return app.request(`/api/v1${path}`, { method: "POST", headers, body: JSON.stringify(body) }, env);
}
function get(env: object, headers: Record<string, string>, path: string) {
  return app.request(`/api/v1${path}`, { headers }, env);
}
function transition(env: object, headers: Record<string, string>, id: string, body: unknown) {
  return post(env, headers, `/market/listings/${id}/transition`, body);
}
async function setCountry(env: object, headers: Record<string, string>, country: string) {
  const r = await app.request("/api/v1/me/preferences", { method: "PATCH", headers, body: JSON.stringify({ country }) }, env);
  expect(r.status).toBe(200);
}
// transition(list_fixed)のみ=状態機械の実体(既存の market-*.test.ts 全体と同じ最小形)。
function listListing(env: object, headers: Record<string, string>, id: string, body: unknown = {}) {
  return post(env, headers, `/market/listings/${id}/transition`, { kind: "list_fixed", ...(body as object) });
}
// POST /market/listings(メタデータ record) + transition を両方行う。GET /market/listings
// の一覧投影はメタデータ record を読むため、一覧除外を検証するテストはこちらを使う
// (listing_id は envelope.id=ULID 制約があるため ulid() を渡すこと)。
async function listListingWithMeta(env: object, headers: Record<string, string>, id: string, body: unknown = {}) {
  const mr = await post(env, headers, "/market/listings", { listing_id: id, title: id });
  expect(mr.status).toBe(201);
  return post(env, headers, `/market/listings/${id}/transition`, { kind: "list_fixed", ...(body as object) });
}

describe("V3-GOV-35 同国スコープ指摘 + 5件閾値非表示", () => {
  it("所属国未設定の指摘者は 403(COUNTRY_SCOPE_MISMATCH)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = await authOf("seller-cs1");
    const flaggerH = await authOf("flagger-cs1");
    await listListing(env, sellerH, "F1");
    const r = await post(env, flaggerH, "/market/listings/F1/flags", {});
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: string }).error).toBe("COUNTRY_SCOPE_MISMATCH");
  });

  it("国が異なる指摘者は 403", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = await authOf("seller-cs2");
    const flaggerH = await authOf("flagger-cs2");
    await setCountry(env, sellerH, "JP");
    await setCountry(env, flaggerH, "US");
    await listListing(env, sellerH, "F2");
    const r = await post(env, flaggerH, "/market/listings/F2/flags", {});
    expect(r.status).toBe(403);
  });

  it("自分の出品には指摘できない(400)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = await authOf("seller-cs3");
    await setCountry(env, sellerH, "JP");
    await listListing(env, sellerH, "F3");
    const r = await post(env, sellerH, "/market/listings/F3/flags", {});
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toBe("CANNOT_FLAG_OWN_LISTING");
  });

  it("同国ユーザーの指摘は既存のΔcountルールを適用し201を返す", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const sellerH = await authOf("seller-cs4");
    const flaggerH = await authOf("flagger-cs4");
    await setCountry(env, sellerH, "JP");
    await setCountry(env, flaggerH, "JP");
    await listListing(env, sellerH, "F4");

    const before = await projectLedger(new TruthStore(bucket), "seller-cs4");
    const r = await post(env, flaggerH, "/market/listings/F4/flags", { reason: "疑わしい" });
    expect(r.status).toBe(201);
    const after = await projectLedger(new TruthStore(bucket), "seller-cs4");
    expect(after.karma_count).toBe(before.karma_count + MKT_LISTING_FLAG_KARMA_STEPS);
  });

  it("同国5ユーザーの指摘で active_flag_count>=5・一覧から除外・直接IDは参照可能", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const sellerH = await authOf("seller-cs5");
    await setCountry(env, sellerH, "JP");
    const listingId = ulid();
    await listListingWithMeta(env, sellerH, listingId);

    for (let i = 0; i < 5; i++) {
      const h = await authOf(`flagger-cs5-${i}`);
      await setCountry(env, h, "JP");
      const r = await post(env, h, `/market/listings/${listingId}/flags`, {});
      expect(r.status).toBe(201);
    }

    const mod = (await (await get(env, sellerH, `/market/listings/${listingId}/flag-status`)).json()) as { active_flag_count: number; hidden: boolean };
    expect(mod.active_flag_count).toBe(5);
    expect(mod.hidden).toBe(true);

    const list = (await (await get(env, sellerH, "/market/listings")).json()) as { listings: { listing_id: string }[] };
    expect(list.listings.some((l) => l.listing_id === listingId)).toBe(false);

    const detail = (await (await get(env, sellerH, `/market/listings/${listingId}`)).json()) as {
      listing: { listing_id: string };
      moderation: { hidden: boolean };
    };
    expect(detail.listing.listing_id).toBe(listingId);
    expect(detail.moderation.hidden).toBe(true);
  });

  it("撤回(action=withdraw)で active_flag_count が減り非表示が解ける", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const sellerH = await authOf("seller-cs6");
    await setCountry(env, sellerH, "JP");
    await listListing(env, sellerH, "F6");
    const flaggerHeaders: Record<string, string>[] = [];
    for (let i = 0; i < 5; i++) {
      const h = await authOf(`flagger-cs6-${i}`);
      await setCountry(env, h, "JP");
      flaggerHeaders.push(h);
      await post(env, h, "/market/listings/F6/flags", {});
    }
    let mod = (await (await get(env, sellerH, "/market/listings/F6/flag-status")).json()) as { hidden: boolean };
    expect(mod.hidden).toBe(true);

    const w = await post(env, flaggerHeaders[0], "/market/listings/F6/flags", { action: "withdraw" });
    expect(w.status).toBe(201);
    mod = (await (await get(env, sellerH, "/market/listings/F6/flag-status")).json()) as { hidden: boolean; active_flag_count: number };
    expect(mod.active_flag_count).toBe(4);
    expect(mod.hidden).toBe(false);
  });
});

describe("V3-GOV-35 国/準国(operator)による近似範囲まるごと停止", () => {
  it("非operatorの gov-stop は 403・何も append しない", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = await authOf("seller-gs1");
    await listListing(env, sellerH, "G1");
    const r = await post(env, AUTH_HEADERS, "/market/listings/G1/gov-stop", {});
    expect(r.status).toBe(403);
  });

  it("未認証の gov-stop は 401", async () => {
    const env = makeEnv();
    const r = await app.request("/api/v1/market/listings/G0/gov-stop", { method: "POST", body: "{}" }, env);
    expect(r.status).toBe(401);
  });

  it("operatorのgov-stopは対象出品者の全出品をまるごと非表示にする(近似範囲)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const sellerH = await authOf("seller-gs2");
    const opH = await authOf("op-gs2", ["operator"]);
    const g2a = ulid();
    const g2b = ulid();
    await listListingWithMeta(env, sellerH, g2a);
    await listListingWithMeta(env, sellerH, g2b);

    const r = await post(env, opH, `/market/listings/${g2a}/gov-stop`, { reason: "行政指摘" });
    expect(r.status).toBe(201);
    expect(((await r.json()) as { government_stopped: boolean }).government_stopped).toBe(true);

    // g2a は直接対象、g2b は同一出品者の近似範囲として巻き込まれる。
    const modA = (await (await get(env, sellerH, `/market/listings/${g2a}/flag-status`)).json()) as { hidden: boolean };
    const modB = (await (await get(env, sellerH, `/market/listings/${g2b}/flag-status`)).json()) as { hidden: boolean };
    expect(modA.hidden).toBe(true);
    expect(modB.hidden).toBe(true);

    const list = (await (await get(env, sellerH, "/market/listings")).json()) as { listings: { listing_id: string }[] };
    expect(list.listings.some((l) => l.listing_id === g2a)).toBe(false);
    expect(list.listings.some((l) => l.listing_id === g2b)).toBe(false);
  });
});

describe("V3-GOV-35 出品停止(非表示5件蓄積)+誤BAN復帰", () => {
  async function suspendSeller(env: ReturnType<typeof makeEnv>, sellerH: Record<string, string>, sellerId: string) {
    await setCountry(env, sellerH, "JP");
    for (let l = 0; l < 5; l++) {
      const listingId = `S-${sellerId}-${l}`;
      await listListing(env, sellerH, listingId);
      for (let i = 0; i < 5; i++) {
        const h = await authOf(`flagger-${sellerId}-${l}-${i}`);
        await setCountry(env, h, "JP");
        await post(env, h, `/market/listings/${listingId}/flags`, {});
      }
    }
  }

  it("非表示5件蓄積で新規出品が403(SELLER_SUSPENDED)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = await authOf("seller-susp1");
    await suspendSeller(env, sellerH, "susp1");
    const r = await transition(env, sellerH, "S-susp1-new", { kind: "list_fixed" });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: string }).error).toBe("SELLER_SUSPENDED");
  });

  it("誤BAN判定(カルマ80以上5人のapprove)未達なら execute は409(NOT_ELIGIBLE)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const sellerH = await authOf("seller-susp2");
    await suspendSeller(env, sellerH, "susp2");

    // カルマ80以上の判定者を4人だけ用意(閾値5未達)。
    const s = new TruthStore(bucket);
    for (let i = 0; i < 4; i++) {
      const voter = `juror-susp2-${i}`;
      await appendKarma(s, voter, "value", 80, "monthly_batch");
      const h = await authOf(voter);
      const vr = await post(env, h, "/gov/votes", { kind: "misban_reversal", proposal_target: "seller-susp2", value: "approve" });
      expect(vr.status).toBe(201);
    }

    const ex = await post(env, sellerH, "/market/sellers/seller-susp2/misban-reversal/execute", {});
    expect(ex.status).toBe(409);
    expect(((await ex.json()) as { error: string }).error).toBe("NOT_ELIGIBLE");
  });

  it("カルマ80以上5人のapproveで復帰: 出品停止が解除・出品者へカルマ+5・判定者へ貢献度付与・冪等", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const sellerH = await authOf("seller-susp3");
    await suspendSeller(env, sellerH, "susp3");
    expect((await transition(env, sellerH, "S-susp3-new", { kind: "list_fixed" })).status).toBe(403);

    const s = new TruthStore(bucket);
    const beforeKarma = await projectLedger(s, "seller-susp3");
    const jurors: string[] = [];
    for (let i = 0; i < 5; i++) {
      const voter = `juror-susp3-${i}`;
      jurors.push(voter);
      await appendKarma(s, voter, "value", 80, "monthly_batch");
      const h = await authOf(voter);
      await post(env, h, "/gov/votes", { kind: "misban_reversal", proposal_target: "seller-susp3", value: "approve" });
    }
    // カルマ不足の投票者は数に入らない(適格フィルタ)。
    const lowKarmaH = await authOf("juror-susp3-lowkarma");
    await post(env, lowKarmaH, "/gov/votes", { kind: "misban_reversal", proposal_target: "seller-susp3", value: "approve" });

    const projBefore = (await (await get(env, sellerH, "/market/sellers/seller-susp3/misban-reversal")).json()) as {
      qualifying_approvals: number;
      reversed: boolean;
    };
    expect(projBefore.qualifying_approvals).toBe(5);
    expect(projBefore.reversed).toBe(true);

    const ex = await post(env, sellerH, "/market/sellers/seller-susp3/misban-reversal/execute", {});
    expect(ex.status).toBe(201);
    const exBody = (await ex.json()) as { reversed: boolean; jurors: string[] };
    expect(exBody.reversed).toBe(true);
    expect(exBody.jurors.sort()).toEqual([...jurors].sort());

    // 25件の指摘(5出品×5件)で積み上がった Fibonacci 減点により karma_value は既に
    // 下限 -100 にクランプ済みのため、投影値の +5 は floor で吸収され見えない(KRM-01の
    // 正当な挙動)。karma+5 が実際に append されたことは raw event で直接検証する。
    const afterKarma = await projectLedger(s, "seller-susp3");
    expect(afterKarma.karma_value).toBeGreaterThanOrEqual(beforeKarma.karma_value);
    const bonusEvent = await s.readEvent("truth/ihl.economy.karma_event.v1/misban-reversal-seller-susp3.json");
    expect((bonusEvent?.data as { delta?: number; reason_code?: string } | undefined)?.delta).toBe(5);
    expect((bonusEvent?.data as { delta?: number; reason_code?: string } | undefined)?.reason_code).toBe("manual");

    for (const juror of jurors) {
      const c = await projectContribution(s, juror);
      expect(c.axes.development.score).toBeGreaterThan(0);
    }

    // 出品停止が解除されている(新規出品が通る)。
    const listAgain = await transition(env, sellerH, "S-susp3-new", { kind: "list_fixed" });
    expect(listAgain.status).toBe(201);

    // 二重実行は冪等(karma は再付与されない)。
    const ex2 = await post(env, sellerH, "/market/sellers/seller-susp3/misban-reversal/execute", {});
    expect(ex2.status).toBe(200);
    expect(((await ex2.json()) as { already_executed: boolean }).already_executed).toBe(true);
    const afterKarma2 = await projectLedger(s, "seller-susp3");
    expect(afterKarma2.karma_value).toBe(afterKarma.karma_value);
  });
});
