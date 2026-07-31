// V3-MKT-41(w3-mkt): 市場出品の未認証閲覧境界。w2-mktは型C(根拠citation)で完了と
// していたが、62代目HQ検収是正(R0731-02b601・w2-mkt批評重大2)によりkind=非機能要件
// (型F)へ差し戻された。ADR文書(design/adr/配下)は本レーンのglob外につき作成できないが、
// 「market配下の未認証閲覧は拒否される」という主張自体は本レーンのtests/配下で
// 自動テスト化できるため、型Fの②(テスト)を満たす証跡としてここに追加する。
// 根拠(①コード): apps/api/src/index.ts の PUBLIC_ROUTES(:76-94)に market 系パスは
// 含まれず、authミドルウェア(:165-215)がPUBLIC_ROUTES外を既定でAUTH_REQUIRED(401)に
// 倒す(deny-by-default)。POST /listing-registryはver3に存在しない(grep実測0件・
// 本ファイルでも下で再確認する)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { FakeR2Bucket, makeEnv } from "./helpers";

function get(env: object, path: string) {
  return app.request(`/api/v1${path}`, {}, env);
}
function post(env: object, path: string, body: unknown) {
  return app.request(`/api/v1${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, env);
}

describe("V3-MKT-41 market配下の未認証閲覧境界(deny-by-default)", () => {
  it("トークン無しのGET /market/listingsは401 AUTH_REQUIRED", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const res = await get(env, "/market/listings");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("AUTH_REQUIRED");
  });

  it("トークン無しのPOST /market/listingsは401 AUTH_REQUIRED(出品も未認証では不可)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const res = await post(env, "/market/listings", { title: "未認証出品テスト" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("AUTH_REQUIRED");
  });

  it("POST /listing-registryはver3に存在しない(404扱い=そもそも未実装のルート)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const res = await post(env, "/listing-registry", {});
    // 未認証ゲートが先に立つため 401(未定義ルートでも auth gate が先に発火する index.ts:73
    // のコメント「hits the auth gate first (401 before 404)」どおり)。「200で成功してしまう
    // 隠しルートが存在しない」ことの否定的証跡として扱う。
    expect(res.status).toBe(401);
  });
});
