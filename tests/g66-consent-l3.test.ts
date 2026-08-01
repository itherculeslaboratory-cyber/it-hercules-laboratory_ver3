// g66-consent(ORDER-2026-08-01-g66-consent): L3(第三者提供・AI学習コーパス)許諾
// フィールド consent_l3(obs-capture.schema.json)の捕獲時点判定。RULING-2026-08-01-
// gen65-ihl-backbone.md §11-2/§12 D-5「初期設定は拒否です」の実装確認。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { ulid } from "@ihl/truth";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";
import { isThirdPartyProvisionConsented, countConsentL3Inventory } from "../apps/api/src/observation-constants";

const JSON_HEADERS = { "content-type": "application/json" };
const AUTH = { Authorization: `Bearer ${DEV_TOKEN}` };
const AUTH_JSON = { ...AUTH, ...JSON_HEADERS };

function ctx() {
  const bucket = new FakeR2Bucket();
  return { bucket, env: makeEnv(bucket) };
}
async function post(path: string, body: unknown, env: object) {
  return app.request(path, { method: "POST", headers: AUTH_JSON, body: JSON.stringify(body) }, env);
}
async function get(path: string, env: object) {
  return app.request(path, { method: "GET", headers: AUTH }, env);
}

describe("isThirdPartyProvisionConsented(純関数・pure)", () => {
  it("未指定(undefined) -> false(未許諾)", () => {
    expect(isThirdPartyProvisionConsented(undefined)).toBe(false);
  });
  it("false -> false", () => {
    expect(isThirdPartyProvisionConsented(false)).toBe(false);
  });
  it("true -> true(提供可)", () => {
    expect(isThirdPartyProvisionConsented(true)).toBe(true);
  });
  // 判定関数を「常にtrueを返す」に差し替えると赤くなることを実機確認済み(このファイル
  // の8件中4件が失敗した — 報告書に実出力を記載。確認後は正しい実装へ戻し全緑を再確認済み)。
});

describe("POST /observation/captures — consent_l3 の捕獲時点記録", () => {
  it("consent_l3 未指定でcaptureを作る -> 保存後のcaptureにconsent_l3が無く、未許諾と判定される", async () => {
    const { env } = ctx();
    const id = ulid();
    const res = await post("/api/v1/observation/captures", { capture_id: id, domain: "biology" }, env);
    expect(res.status).toBe(202);
    const detail = await get(`/api/v1/observation/${id}`, env);
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as { capture: Record<string, unknown> };
    expect(body.capture.consent_l3).toBeUndefined();
    expect(isThirdPartyProvisionConsented(body.capture.consent_l3 as boolean | undefined)).toBe(false);
  });

  it("consent_l3=true を明示指定 -> 保存され、提供可と判定される", async () => {
    const { env } = ctx();
    const id = ulid();
    const res = await post("/api/v1/observation/captures", { capture_id: id, domain: "biology", consent_l3: true }, env);
    expect(res.status).toBe(202);
    const detail = await get(`/api/v1/observation/${id}`, env);
    const body = (await detail.json()) as { capture: Record<string, unknown> };
    expect(body.capture.consent_l3).toBe(true);
    expect(isThirdPartyProvisionConsented(body.capture.consent_l3 as boolean | undefined)).toBe(true);
  });

  it("consent_l3=false を明示指定 -> 未許諾のまま保存される(既定値を許諾ありにしない)", async () => {
    const { env } = ctx();
    const id = ulid();
    const res = await post("/api/v1/observation/captures", { capture_id: id, domain: "biology", consent_l3: false }, env);
    expect(res.status).toBe(202);
    const detail = await get(`/api/v1/observation/${id}`, env);
    const body = (await detail.json()) as { capture: Record<string, unknown> };
    expect(body.capture.consent_l3).toBe(false);
    expect(isThirdPartyProvisionConsented(body.capture.consent_l3 as boolean | undefined)).toBe(false);
  });
});

describe("countConsentL3Inventory(純関数・遡及書き換えなしで在庫を数える)", () => {
  it("granted/denied/missingを内訳集計する", () => {
    const result = countConsentL3Inventory([
      { consent_l3: true },
      { consent_l3: false },
      {},
      { consent_l3: undefined },
    ]);
    expect(result).toEqual({ total: 4, granted: 1, denied: 1, missing: 2 });
  });
});

describe("GET /observation/consent-l3-inventory", () => {
  it("consent_l3を1件も指定していない環境ではmissing=totalになる", async () => {
    const { env } = ctx();
    await post("/api/v1/observation/captures", { capture_id: ulid(), domain: "biology" }, env);
    await post("/api/v1/observation/captures", { capture_id: ulid(), domain: "biology" }, env);
    const res = await get("/api/v1/observation/consent-l3-inventory", env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; missing: number; granted: number; denied: number };
    expect(body.total).toBe(2);
    expect(body.missing).toBe(2);
    expect(body.granted).toBe(0);
  });
});
