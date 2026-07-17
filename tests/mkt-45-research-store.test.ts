// V3-MKT-45: 研究成果(project_id)に紐づく研究支援ストア。プラチナ/代引き/外部EC誘導の
// 3方式・在庫チェック必須+決済成功時の自動減算(都度再計算)・外部EC同期は実鍵無しで
// 縮退(research-ec-adapter.ts)。
import { describe, expect, it } from "vitest";
import { TruthStore } from "@ihl/truth";
import app from "../apps/api/src/index";
import { grantPlatinum } from "../apps/api/src/ledger-routes";
import { issueSessionToken } from "../apps/api/src/session";
import { auditLedger } from "../apps/api/src/ledger-audit-routes";
import { AUTH_HEADERS, FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}
function postItem(env: object, headers: Record<string, string>, body: unknown) {
  return app.request("/api/v1/research/store/items", { method: "POST", headers, body: JSON.stringify(body) }, env);
}
function postOrder(env: object, headers: Record<string, string>, itemId: string, body: unknown) {
  return app.request(
    `/api/v1/research/store/items/${itemId}/orders`,
    { method: "POST", headers, body: JSON.stringify(body) },
    env,
  );
}

describe("POST /api/v1/research/store/items", () => {
  it("認証なし → 401", async () => {
    const res = await postItem(makeEnv(), {}, {});
    expect(res.status).toBe(401);
  });

  it("必須項目欠如 → 400 / platinum許可時はprice_platinum必須", async () => {
    const env = makeEnv();
    const missing = await postItem(env, AUTH_HEADERS, { title: "t" });
    expect(missing.status).toBe(400);
    const noPricing = await postItem(env, AUTH_HEADERS, {
      project_id: "P1", title: "T恤", inventory_count: 5, payment_methods: ["platinum"],
    });
    expect(noPricing.status).toBe(400);
  });

  it("出品できる(在庫count/決済方式)", async () => {
    const res = await postItem(makeEnv(), AUTH_HEADERS, {
      project_id: "P1", title: "研究Tシャツ", inventory_count: 3, payment_methods: ["platinum", "cod"], price_platinum: 5,
    });
    expect(res.status).toBe(201);
  });
});

describe("POST /api/v1/research/store/items/{id}/orders", () => {
  it("在庫チェック: 可用在庫を超える注文は409 OUT_OF_STOCK", async () => {
    const env = makeEnv();
    const item = (await (
      await postItem(env, AUTH_HEADERS, { project_id: "P1", title: "限定品", inventory_count: 2, payment_methods: ["cod"] })
    ).json()) as { item_id: string };
    const res = await postOrder(env, AUTH_HEADERS, item.item_id, { payment_method: "cod", quantity: 3 });
    expect(res.status).toBe(409);
  });

  it("代引き(cod)は残高チェック不要で即成立し、在庫が自動減算される(都度再計算)", async () => {
    const env = makeEnv();
    const item = (await (
      await postItem(env, AUTH_HEADERS, { project_id: "P1", title: "普通品", inventory_count: 5, payment_methods: ["cod"] })
    ).json()) as { item_id: string };
    const order = await postOrder(env, AUTH_HEADERS, item.item_id, { payment_method: "cod", quantity: 2 });
    expect(order.status).toBe(201);

    const list = (await (await app.request("/api/v1/research/store/items?project_id=P1", { headers: AUTH_HEADERS }, env)).json()) as {
      items: { item_id: string; available: number }[];
    };
    expect(list.items.find((x) => x.item_id === item.item_id)!.available).toBe(3);
  });

  it("許可されていない決済方式は400", async () => {
    const env = makeEnv();
    const item = (await (
      await postItem(env, AUTH_HEADERS, { project_id: "P1", title: "現金専用", inventory_count: 5, payment_methods: ["cod"] })
    ).json()) as { item_id: string };
    const res = await postOrder(env, AUTH_HEADERS, item.item_id, { payment_method: "platinum", quantity: 1 });
    expect(res.status).toBe(400);
  });

  it("プラチナ決済: 残高不足は402、残高十分なら成立してコインが減算される(2ストリーム差引き)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const buyerH = bearer(await issueSessionToken("buyer", SESSION_SECRET));
    const s = new TruthStore(bucket);
    await grantPlatinum(s, "buyer", 10, "manual");

    const item = (await (
      await postItem(env, buyerH, { project_id: "P1", title: "PT商品", inventory_count: 5, payment_methods: ["platinum"], price_platinum: 4 })
    ).json()) as { item_id: string };

    const tooExpensive = await postOrder(env, buyerH, item.item_id, { payment_method: "platinum", quantity: 3 }); // 4*3=12 > 10
    expect(tooExpensive.status).toBe(402);

    const ok = await postOrder(env, buyerH, item.item_id, { payment_method: "platinum", quantity: 2 }); // 4*2=8 <= 10
    expect(ok.status).toBe(201);

    // 台帳検算(V3-MKT-40)がストア注文の消費も貸借差引きの対象に含めていることを確認。
    const report = await auditLedger(s);
    expect(report.balanced).toBe(true);
  });

  it("外部EC誘導(external_ec)は実鍵無しで縮退するが注文自体はブロックしない", async () => {
    const env = makeEnv();
    const item = (await (
      await postItem(env, AUTH_HEADERS, {
        project_id: "P1", title: "外部EC品", inventory_count: 5, payment_methods: ["external_ec"], external_ec_url: "https://example.com/shop",
      })
    ).json()) as { item_id: string };
    const res = await postOrder(env, AUTH_HEADERS, item.item_id, { payment_method: "external_ec", quantity: 1 });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { external_ec_sync: { synced: boolean } };
    expect(body.external_ec_sync.synced).toBe(false); // 実鍵無し=縮退
  });
});
