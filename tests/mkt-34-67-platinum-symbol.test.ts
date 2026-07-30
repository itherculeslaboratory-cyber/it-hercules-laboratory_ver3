// V3-MKT-34(プラチナコインショップ Symbol 二段階購入・第19回裁定で救済)+ V3-MKT-67
// (制約: Symbol は運営者のみ発行・一般ユーザーは出品できない)。
import { describe, expect, it } from "vitest";
import { TruthStore, ulid } from "@ihl/truth";
import app from "../apps/api/src/index";
import { issueSessionToken } from "../apps/api/src/session";
import { marketPlatinumSymbolRoutes } from "../apps/api/src/market-platinum-symbol-routes";
import { FakeR2Bucket, SESSION_SECRET, makeEnv } from "./helpers";

// index.ts の mount 行は艦が直接書かず報告書に挿入位置を明記する(KIT-TEMPLATE §7・
// mkt-21-intl-shipping.test.ts と同型の実行時マウント=index.ts ファイル自体は不変)。
app.route("/api/v1", marketPlatinumSymbolRoutes);

function bearer(tok: string) {
  return { Authorization: `Bearer ${tok}`, "content-type": "application/json" };
}
function post(env: object, headers: Record<string, string>, path: string, body?: unknown) {
  return app.request(`/api/v1${path}`, { method: "POST", headers, body: body !== undefined ? JSON.stringify(body) : undefined }, env);
}
function get(env: object, headers: Record<string, string>, path: string) {
  return app.request(`/api/v1${path}`, { headers }, env);
}
async function grantPt(bucket: FakeR2Bucket, actorId: string, amount: number) {
  const s = new TruthStore(bucket);
  const id = ulid();
  await s.putEvent({
    specversion: "1.0",
    id,
    source: "apps/api",
    type: "ihl.economy.pt_event.v1",
    time: new Date().toISOString(),
    dataschema: "schemas/events/economy-pt-event.schema.json",
    provenance: { generator_kind: "human", actor_id: actorId },
    data: {
      pt_event_id: id,
      actor_id: actorId,
      delta: amount,
      reason_code: "mint",
      created_at: new Date().toISOString(),
      schema_version: "1",
    },
  });
}

describe("V3-MKT-67 運営者限定発行", () => {
  it("operator/adminロールが無いセッションはSymbol作成403", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const userH = bearer(await issueSessionToken("sym-user1", SESSION_SECRET));
    const res = await post(env, userH, "/market/platinum-symbols", { year: 2026, name: "年間最高傑作" });
    expect(res.status).toBe(403);
  });

  it("operatorロールなら201・同年2個目は409(年1個限定)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const opH = bearer(await issueSessionToken("sym-op1", SESSION_SECRET, ["operator"]));
    const first = await post(env, opH, "/market/platinum-symbols", { year: 2026, name: "年間最高傑作2026" });
    expect(first.status).toBe(201);
    const dup = await post(env, opH, "/market/platinum-symbols", { year: 2026, name: "別名義" });
    expect(dup.status).toBe(409);
  });
});

describe("V3-MKT-34 プラチナ100枚の購入権(先着1名)", () => {
  it("PT不足は402・PT>=100で先着取得成功・2人目は409(ALREADY_HELD)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const opH = bearer(await issueSessionToken("sym-op2", SESSION_SECRET, ["operator"]));
    const created = await post(env, opH, "/market/platinum-symbols", { year: 2027, name: "年間最高傑作2027" });
    const symbolId = ((await created.json()) as { symbol_id: string }).symbol_id;

    const poorH = bearer(await issueSessionToken("sym-poor1", SESSION_SECRET));
    const poorRes = await post(env, poorH, `/market/platinum-symbols/${symbolId}/purchase-right`);
    expect(poorRes.status).toBe(402);

    const richH = bearer(await issueSessionToken("sym-rich1", SESSION_SECRET));
    await grantPt(bucket, "sym-rich1", 100);
    const richRes = await post(env, richH, `/market/platinum-symbols/${symbolId}/purchase-right`);
    expect(richRes.status).toBe(201);

    const rich2H = bearer(await issueSessionToken("sym-rich2", SESSION_SECRET));
    await grantPt(bucket, "sym-rich2", 100);
    const secondRes = await post(env, rich2H, `/market/platinum-symbols/${symbolId}/purchase-right`);
    expect(secondRes.status).toBe(409);

    const detail = (await (await get(env, richH, `/market/platinum-symbols/${symbolId}`)).json()) as { holder_actor_id?: string };
    expect(detail.holder_actor_id).toBe("sym-rich1");
  });
});
