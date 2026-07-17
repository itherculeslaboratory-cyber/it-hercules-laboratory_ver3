// V3-GOV-35 観測モジュール側freeze TC。round-15裁定(#6/#7)の逐語「GOV-35=出品/観測の
// 機械的範囲停止・可逆」に基づき、既存の出品者suspended投影(market-flag-routes.
// projectSellerModeration)をそのまま観測commitの入口ゲートに適用する。新しい設計は
// 発明せず、既承認のsuspended signalを再利用するのみ(可逆性もmisban-reversalに一本化)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { appendKarma } from "../apps/api/src/ledger-routes";
import { TruthStore } from "@ihl/truth";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

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
async function setCountry(env: object, headers: Record<string, string>, country: string) {
  expect((await app.request("/api/v1/me/preferences", { method: "PATCH", headers, body: JSON.stringify({ country }) }, env)).status).toBe(200);
}
function listListing(env: object, headers: Record<string, string>, id: string) {
  return post(env, headers, `/market/listings/${id}/transition`, { kind: "list_fixed" });
}

/** 同型: tests/market-flag.test.ts suspendSeller — 5 listing × 5 flag で
 * MKT_SELLER_SUSPEND_THRESHOLD(=5非表示)に到達させる。 */
async function suspendSeller(env: object, sellerH: Record<string, string>, sellerId: string) {
  await setCountry(env, sellerH, "JP");
  for (let l = 0; l < 5; l++) {
    const listingId = `OBSFZ-${sellerId}-${l}`;
    await listListing(env, sellerH, listingId);
    for (let i = 0; i < 5; i++) {
      const h = await authOf(`flagger-${sellerId}-${l}-${i}`);
      await setCountry(env, h, "JP");
      await post(env, h, `/market/listings/${listingId}/flags`, {});
    }
  }
}

describe("V3-GOV-35 観測モジュール側freeze", () => {
  it("suspended状態の出品者は新規observation captureが403 OBSERVATION_FROZEN", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = await authOf("seller-obsfz1");
    await suspendSeller(env, sellerH, "obsfz1");

    // 既存GOV-35(市場側)がすでにsuspendedであることを前提として確認。
    expect((await (await get(env, sellerH, "/market/sellers/seller-obsfz1/flag-status")).json() as { suspended: boolean }).suspended).toBe(true);

    const res = await post(env, sellerH, "/solid-observation/commit", { domain: "biology" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("OBSERVATION_FROZEN");
  });

  it("batch-commit capture kindも同様にfreezeされる(部分失敗として報告)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const sellerH = await authOf("seller-obsfz2");
    await suspendSeller(env, sellerH, "obsfz2");

    const res = await post(env, sellerH, "/observation/batch-commit", { items: [{ kind: "capture", body: { domain: "biology" } }] });
    expect(res.status).toBe(200); // batch-commit itself always 200 — per-item failure surfaced
    const body = (await res.json()) as { results: { ok: boolean; error?: string }[] };
    expect(body.results[0]).toEqual({ ok: false, error: "OBSERVATION_FROZEN" });
  });

  it("凍結されていない通常ユーザーの観測commitは影響を受けない", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const normalH = await authOf("seller-obsfz-normal");
    const res = await post(env, normalH, "/solid-observation/commit", { domain: "biology" });
    expect(res.status).toBe(202);
  });

  it("誤BAN復帰(misban-reversal)後は観測freezeも自動的に解除される(可逆・別解除操作は不要)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const sellerH = await authOf("seller-obsfz3");
    await suspendSeller(env, sellerH, "obsfz3");
    expect((await post(env, sellerH, "/solid-observation/commit", { domain: "biology" })).status).toBe(403);

    const s = new TruthStore(bucket);
    for (let i = 0; i < 5; i++) {
      const voter = `juror-obsfz3-${i}`;
      await appendKarma(s, voter, "value", 80, "monthly_batch");
      const h = await authOf(voter);
      expect((await post(env, h, "/gov/votes", { kind: "misban_reversal", proposal_target: "seller-obsfz3", value: "approve" })).status).toBe(201);
    }
    expect((await post(env, sellerH, "/market/sellers/seller-obsfz3/misban-reversal/execute", {})).status).toBe(201);

    const res = await post(env, sellerH, "/solid-observation/commit", { domain: "biology" });
    expect(res.status).toBe(202);
  });
});
